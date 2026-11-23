import { EventSubscriber, EntitySubscriberInterface, InsertEvent } from 'typeorm';
import { TenantContext } from './tenant-context';

/**
 * 租户订阅器：INSERT 前自动从 TenantContext 填充 company_id，业务代码无感知。
 * （显式赋值优先，兜底 0 = 种子/系统级数据。）
 */
@EventSubscriber()
export class CompanyIdSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<any>): void {
    const entity = event.entity;
    if (!entity || typeof entity !== 'object' || !('companyId' in entity)) return;
    if (entity.companyId === undefined || entity.companyId === null || entity.companyId === 0) {
      const companyId = TenantContext.getCompanyId();
      if (companyId !== undefined) {
        entity.companyId = companyId;
      }
    }
  }
}