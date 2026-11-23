import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BuiltInRoles, PermissionOverrideType } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCodes } from '@pms/shared';
import {
  RoleEntity,
  UserEntity,
  UserPermissionOverrideEntity,
  UserProjectScopeEntity,
  UserRoleEntity,
} from '../../database/entities/auth-entities';
import { PermissionService } from '../permission/permission.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity) private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(UserPermissionOverrideEntity) private readonly overrideRepo: Repository<UserPermissionOverrideEntity>,
    @InjectRepository(UserProjectScopeEntity) private readonly scopeRepo: Repository<UserProjectScopeEntity>,
    private readonly permissionService: PermissionService,
    private readonly authService: AuthService,
  ) {}

  async listUsers(companyId: number) {
    const users = await this.userRepo.find({ where: { companyId } });
    const roles = await this.userRoleRepo.find({ where: { companyId } });
    const roleEntities = await this.roleRepo.find({ where: { companyId } });
    const roleMap = new Map(roleEntities.map((r) => [r.id, r.code]));
    const scopes = await this.scopeRepo.find({ where: { companyId } });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      realName: u.realName,
      status: u.status,
      allProjectsScope: u.allProjectsScope,
      projectScopes: scopes.filter((s) => s.userId === u.id).map((s) => s.projectId),
      roles: roles.filter((r) => r.userId === u.id).map((r) => roleMap.get(r.roleId)).filter(Boolean),
    }));
  }

  /** 建账号（配角色） */
  async createUser(companyId: number, username: string, password: string, realName: string, roleCodes: string[]) {
    const exists = await this.userRepo.findOne({ where: { companyId, username } });
    if (exists) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '用户名已存在');
    }
    const { hashPassword } = await import('../../database/seeds/seed.service');
    const user = await this.userRepo.save(
      this.userRepo.create({
        companyId,
        username,
        passwordHash: hashPassword(password),
        realName,
        status: 'active',
        allProjectsScope: false,
      }),
    );
    await this.assignRoles(companyId, user.id, roleCodes);
    return user;
  }

  /** 修改账号；PATCH 停用即离职生效路径（记录 disabled_at） */
  async updateUser(companyId: number, userId: number, patch: { realName?: string; status?: string }) {
    const user = await this.userRepo.findOne({ where: { id: userId, companyId } });
    if (!user) throw new BadRequestException('用户不存在');
    if (patch.realName) user.realName = patch.realName;
    if (patch.status === 'disabled') {
      user.status = 'disabled';
      user.disabledAt = new Date().toISOString();
    } else if (patch.status === 'active') {
      user.status = 'active';
      user.disabledAt = undefined;
    }
    await this.userRepo.save(user);
    return user;
  }

  async listRoles(companyId: number) {
    return this.roleRepo.find({ where: { companyId } });
  }

  /** 角色管理（内置角色禁删） */
  async deleteRole(companyId: number, roleId: number) {
    const role = await this.roleRepo.findOne({ where: { id: roleId, companyId } });
    if (!role) throw new BadRequestException('角色不存在');
    if (role.builtIn) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '内置角色禁止删除');
    }
    await this.roleRepo.remove(role);
  }

  async createRole(companyId: number, code: string, name: string, permissionIds: number[]) {
    const exists = await this.roleRepo.findOne({ where: { companyId, code } });
    if (exists) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '角色编码已存在');
    const role = await this.roleRepo.save(this.roleRepo.create({ companyId, code, name, builtIn: false }));
    await this.setRolePermissions(companyId, role.id, permissionIds);
    return role;
  }

  async setRolePermissions(companyId: number, roleId: number, permissionIds: number[]) {
    const { RolePermissionEntity } = await import('../../database/entities/auth-entities');
    const repo = this.userRoleRepo.manager.getRepository(RolePermissionEntity);
    await repo.delete({ companyId, roleId });
    if (permissionIds.length > 0) {
      await repo.save(permissionIds.map((pid) => repo.create({ companyId, roleId, permissionId: pid })));
    }
  }

  /** 用户权限配置查看（操作权限与查询项权限） */
  async getUserPermissions(companyId: number, userId: number) {
    const resolved = await this.permissionService.resolveForUser(companyId, userId);
    const overrides = await this.overrideRepo.find({ where: { companyId, userId } });
    const scopes = await this.scopeRepo.find({ where: { companyId, userId } });
    return {
      permissions: [...resolved.permissions],
      overrides,
      allProjectsScope: (await this.userRepo.findOne({ where: { id: userId } }))?.allProjectsScope ?? false,
      projectScopes: scopes.map((s) => s.projectId),
    };
  }

  /** 用户权限配置保存（覆盖允许/拒绝） */
  async putUserPermissions(companyId: number, userId: number, overrides: { permissionCode: string; overrideType: 'allow' | 'deny' }[]) {
    await this.overrideRepo.delete({ companyId, userId });
    if (overrides.length > 0) {
      await this.overrideRepo.save(
        overrides.map((o) =>
          this.overrideRepo.create({ companyId, userId, permissionCode: o.permissionCode, overrideType: o.overrideType as PermissionOverrideType }),
        ),
      );
    }
  }

  /** 项目数据范围授权 */
  async putProjectScopes(companyId: number, userId: number, allProjectsScope: boolean, projectIds: number[]) {
    const user = await this.userRepo.findOne({ where: { id: userId, companyId } });
    if (!user) throw new BadRequestException('用户不存在');
    user.allProjectsScope = allProjectsScope;
    await this.userRepo.save(user);
    await this.scopeRepo.delete({ companyId, userId });
    if (!allProjectsScope && projectIds.length > 0) {
      await this.scopeRepo.save(projectIds.map((pid) => this.scopeRepo.create({ companyId, userId, projectId: pid })));
    }
  }

  private async assignRoles(companyId: number, userId: number, roleCodes: string[]) {
    if (roleCodes.length === 0) return;
    const roles = await this.roleRepo.find({ where: { companyId, code: In(roleCodes) } });
    if (roles.length > 0) {
      await this.userRoleRepo.save(roles.map((r) => this.userRoleRepo.create({ companyId, userId, roleId: r.id })));
    }
  }
}