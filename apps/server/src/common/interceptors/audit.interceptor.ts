import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { tap } from 'rxjs/operators';
import { ErrorCodes } from '@pms/shared';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AUDIT_KEY } from './audit.decorator';
import { AuditLogEntity } from '../../database/entities/auth-entities';
import { getDataSource } from '../../database/data-source-holder';

/** 审计拦截器：自动采集操作人/时间/内容/结果（权限变更、缴费、优惠与抵扣、员工停用等） */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const actionType = this.reflector.get<string>(AUDIT_KEY, context.getHandler());
    if (!actionType) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const tenant = TenantContext.get();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: async (data) => {
          await this.writeLog(actionType, request, tenant, 'SUCCESS', data, startedAt);
        },
        error: async (err) => {
          await this.writeLog(actionType, request, tenant, `FAILED:${err?.response?.bizCode ?? err?.message ?? 'unknown'}`, null, startedAt);
        },
      }),
    );
  }

  private async writeLog(actionType: string, request: Request, tenant: { companyId: number; userId?: number } | undefined, result: string, data: unknown, startedAt: number) {
    const dataSource = await getDataSource();
    await dataSource.getRepository(AuditLogEntity).save(
      dataSource.getRepository(AuditLogEntity).create({
        companyId: tenant?.companyId ?? 0,
        operatorId: tenant?.userId,
        actionType,
        actionContent: JSON.stringify({
          method: request.method,
          url: request.originalUrl,
          body: request.body,
          durationMs: Date.now() - startedAt,
          resultSummary: typeof data === 'object' && data !== null && 'orderNo' in (data as object) ? { orderNo: (data as { orderNo: string }).orderNo } : undefined,
        }),
        result,
      }),
    );
  }
}