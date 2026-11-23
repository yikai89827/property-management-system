import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { BuiltInRoles, ErrorCodes } from '@pms/shared';
import { TenantContext } from '../../common/tenant/tenant-context';
import { BusinessException } from '../exceptions/business.exception';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { COMPANY_ADMIN_KEY } from './require-company-admin.decorator';
import { PermissionService } from '../../modules/permission/permission.service';
import { AuditLogEntity, RoleEntity, UserRoleEntity } from '../../database/entities/auth-entities';
import { getDataSource } from '../../database/data-source-holder';

/**
 * 权限守卫：读取接口声明的权限点实时校验（每请求查库，无缓存）。
 * 无权限返回 PMS-1003 并写越权审计日志。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity) private readonly userRoleRepo: Repository<UserRoleEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requireCompanyAdmin = this.reflector.get<boolean>(COMPANY_ADMIN_KEY, context.getHandler());
    if ((!required || required.length === 0) && !requireCompanyAdmin) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const tenant = TenantContext.get();
    if (!tenant?.userId) {
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, undefined, 401);
    }

    if (requireCompanyAdmin) {
      const adminOk = await this.isCompanyAdmin(tenant.companyId, tenant.userId);
      if (!adminOk) {
        await this.writeDeniedLog(tenant.companyId, tenant.userId, request, 'company_admin');
        throw new BusinessException(ErrorCodes.FORBIDDEN, undefined, 403);
      }
    }

    if (required && required.length > 0) {
      const resolved = await this.permissionService.resolveForUser(tenant.companyId, tenant.userId);
      const ok = required.every((p) => resolved.permissions.has(p));
      if (!ok) {
        await this.writeDeniedLog(tenant.companyId, tenant.userId, request, required.join(', '));
        throw new BusinessException(ErrorCodes.FORBIDDEN, undefined, 403);
      }
      // 将数据范围写入请求上下文，供数据范围过滤器使用
      tenant.projectScopes = resolved.projectScopes;
      tenant.allProjectsScope = resolved.allProjectsScope;
    }
    return true;
  }

  private async isCompanyAdmin(companyId: number, userId: number): Promise<boolean> {
    const adminRole = await this.roleRepo.findOne({ where: { companyId, code: BuiltInRoles.COMPANY_ADMIN } });
    if (!adminRole) return false;
    const userRole = await this.userRoleRepo.findOne({ where: { companyId, userId, roleId: adminRole.id } });
    return !!userRole;
  }

  private async writeDeniedLog(companyId: number, userId: number, request: Request, missing: string) {
    const dataSource = await getDataSource();
    await dataSource.getRepository(AuditLogEntity).save(
      dataSource.getRepository(AuditLogEntity).create({
        companyId,
        operatorId: userId,
        actionType: 'PERMISSION_DENIED',
        actionContent: `越权访问 ${request.method} ${request.originalUrl}，缺少权限：${missing}`,
        result: 'DENIED',
      }),
    );
  }
}
