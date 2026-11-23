import { Injectable } from '@nestjs/common';
import { TenantContext, TenantPayload } from './tenant-context';

/** 业务层租户上下文便捷服务 */
@Injectable()
export class TenantService {
  get(): TenantPayload | undefined {
    return TenantContext.get();
  }

  requireCompanyId(): number {
    const companyId = TenantContext.getCompanyId();
    if (companyId === undefined) {
      throw new Error('tenant context missing (company_id)');
    }
    return companyId;
  }

  requireUserId(): number {
    const userId = TenantContext.get()?.userId;
    if (userId === undefined) {
      throw new Error('tenant context missing (user_id)');
    }
    return userId;
  }

  isOwner(): boolean {
    return TenantContext.get()?.isOwner ?? false;
  }

  /** 数据范围：无权限项目 ID 列表过滤（all_projects_scope=true 返回全部） */
  scopeFilter(allProjectsScope: boolean, projectScopes: number[]): (projectId: number) => boolean {
    if (allProjectsScope) return () => true;
    const set = new Set(projectScopes);
    return (projectId: number) => set.has(projectId);
  }
}