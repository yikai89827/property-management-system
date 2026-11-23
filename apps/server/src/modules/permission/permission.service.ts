import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PermissionOverrideType, PermissionType } from '@pms/shared';
import { RoleEntity, PermissionEntity, RolePermissionEntity, UserPermissionOverrideEntity, UserRoleEntity, UserProjectScopeEntity, UserEntity } from '../../database/entities/auth-entities';

export interface ResolvedPermissions {
  permissions: Set<string>;
  allProjectsScope: boolean;
  projectScopes: number[];
}

/**
 * 权限解析服务：最终权限 = 角色并集 ∪ 用户覆盖允许 − 用户覆盖拒绝。
 * 每请求实时查库（无会话缓存、无 TTL），权限回收后下一次请求立即生效。
 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity) private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(UserRoleEntity) private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(RolePermissionEntity) private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity) private readonly overrideRepo: Repository<UserPermissionOverrideEntity>,
    @InjectRepository(UserProjectScopeEntity) private readonly projectScopeRepo: Repository<UserProjectScopeEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  /** 实时解析用户最终权限与项目数据范围 */
  async resolveForUser(companyId: number, userId: number): Promise<ResolvedPermissions> {
    const userRoles = await this.userRoleRepo.find({ where: { companyId, userId } });
    let permissionCodes = new Set<string>();
    if (userRoles.length > 0) {
      const rolePerms = await this.rolePermissionRepo.find({
        where: { companyId, roleId: In(userRoles.map((r) => r.roleId)) },
      });
      const permIds = [...new Set(rolePerms.map((rp) => rp.permissionId))];
      if (permIds.length > 0) {
        const perms = await this.permissionRepo.find({ where: { id: In(permIds) } });
        permissionCodes = new Set(perms.map((p) => p.code));
      }
    }

    const overrides = await this.overrideRepo.find({ where: { companyId, userId } });
    for (const o of overrides) {
      if (o.overrideType === PermissionOverrideType.ALLOW) {
        permissionCodes.add(o.permissionCode);
      } else if (o.overrideType === PermissionOverrideType.DENY) {
        permissionCodes.delete(o.permissionCode);
      }
    }

    const scope = await this.projectScopeRepo.find({ where: { companyId, userId } });
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return {
      permissions: permissionCodes,
      allProjectsScope: user?.allProjectsScope ?? false,
      projectScopes: scope.map((s) => s.projectId),
    };
  }

  /** 权限点全量清单（前端权限树分组） */
  async listPermissions(): Promise<PermissionEntity[]> {
    return this.permissionRepo.find({ order: { groupName: 'ASC', sortOrder: 'ASC' } });
  }

  /** 权限点类型判断（operation/query_scope） */
  async getPermissionType(code: string): Promise<PermissionType | undefined> {
    const p = await this.permissionRepo.findOne({ where: { code } });
    return p?.type;
  }
}