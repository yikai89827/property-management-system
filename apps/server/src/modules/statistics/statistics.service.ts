import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChargeType, ErrorCodes, ReceiptStatus } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TenantService } from '../../common/tenant/tenant.service';
import { PropertyFeeLedgerEntity, ReceiptOrderEntity, ReceiptOrderItemEntity } from '../../database/entities/charging-entities';
import { CustomerEntity, ProjectEntity } from '../../database/entities/org-entities';

/**
 * 统计口径：以收款单为准，仅 effective 状态计入，pending/void 不计入实收。
 * 项目范围受 user_project_scope / all_projects_scope 约束。
 */
@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(ReceiptOrderEntity) private readonly receiptRepo: Repository<ReceiptOrderEntity>,
    @InjectRepository(ReceiptOrderItemEntity) private readonly itemRepo: Repository<ReceiptOrderItemEntity>,
    @InjectRepository(PropertyFeeLedgerEntity) private readonly ledgerRepo: Repository<PropertyFeeLedgerEntity>,
    @InjectRepository(CustomerEntity) private readonly customerRepo: Repository<CustomerEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly tenantService: TenantService,
  ) {}

  private scopedProjectIds(companyId: number, projectIds?: number[]): number[] {
    const tenant = this.tenantService.get();
    const allowed = tenant?.allProjectsScope
      ? null
      : new Set(tenant?.projectScopes ?? []);
    const requested = projectIds && projectIds.length > 0 ? projectIds : null;
    if (allowed === null) {
      return requested ?? [];
    }
    const filtered = requested ? requested.filter((id) => allowed.has(id)) : [...allowed];
    return filtered;
  }

  private effectiveWhere(companyId: number, startTime?: string, endTime?: string, projectIds?: number[]) {
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .where('r.companyId = :companyId', { companyId })
      .andWhere('r.status = :status', { status: ReceiptStatus.EFFECTIVE });
    if (startTime) qb.andWhere('r.createdAt >= :startTime', { startTime });
    if (endTime) qb.andWhere('r.createdAt <= :endTime', { endTime });
    const scoped = this.scopedProjectIds(companyId, projectIds);
    if (scoped.length > 0) qb.andWhere('r.projectId IN (:...scoped)', { scoped });
    else if (scoped.length === 0 && !this.tenantService.get()?.allProjectsScope && !projectIds?.length) {
      // 无项目权限且未指定项目：空结果
      qb.andWhere('1 = 0');
    }
    return qb;
  }

  /** 月度统计（自然月应收/实收/优惠/押金汇总） */
  async monthly(companyId: number, startTime?: string, endTime?: string, projectIds?: number[]) {
    const qb = this.effectiveWhere(companyId, startTime, endTime, projectIds);
    const orders = await qb.getMany();
    return this.summarize(orders);
  }

  /** 年度统计（各月汇总 + 年度合计） */
  async yearly(companyId: number, year: string, projectIds?: number[]) {
    const startTime = `${year}-01-01`;
    const endTime = `${year}-12-31T23:59:59.999Z`;
    const orders = await this.effectiveWhere(companyId, startTime, endTime, projectIds).getMany();
    const byMonth = new Map<string, typeof orders>();
    for (const o of orders) {
      const month = o.createdAt.slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(o);
    }
    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, list]) => ({ month, summary: this.summarize(list) }));
    return { year, months, total: this.summarize(orders) };
  }

  /** 分类统计（按收费类别：交房缴费各费用项/物业费/其他缴费各字典类别） */
  async category(companyId: number, startTime?: string, endTime?: string, projectIds?: number[]) {
    const orders = await this.effectiveWhere(companyId, startTime, endTime, projectIds).getMany();
    if (orders.length === 0) return [];
    const items = await this.itemRepo
      .createQueryBuilder('i')
      .where('i.orderId IN (:...orderIds)', { orderIds: orders.map((o) => o.id) })
      .getMany();
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const byCategory = new Map<string, { receivable: number; received: number; discount: number; count: number }>();
    for (const item of items) {
      const order = orderMap.get(item.orderId);
      if (!order) continue;
      const category = item.feeCategoryRef
        ? `OTHER:${item.feeItemCode}`
        : item.feeItemCode;
      const entry = byCategory.get(category) ?? { receivable: 0, received: 0, discount: 0, count: 0 };
      entry.receivable += item.amount;
      entry.received += item.amount;
      entry.discount += order.discountAmount;
      entry.count += 1;
      byCategory.set(category, entry);
    }
    return [...byCategory.entries()].map(([category, v]) => ({
      category,
      receivableAmount: v.receivable,
      receivedAmount: v.received,
      discountAmount: v.discount,
      orderCount: v.count,
    }));
  }

  /** 欠费统计（按项目/房号维度汇总+明细） */
  async arrears(companyId: number, projectIds?: number[]) {
    const scoped = this.scopedProjectIds(companyId, projectIds);
    const customers = await this.customerRepo.find({ where: { companyId } });
    const scopedSet = new Set(scoped);
    const inScope = scopedSet.size > 0 ? customers.filter((c) => scopedSet.has(c.projectId)) : (this.tenantService.get()?.allProjectsScope ? customers : []);
    const ledgers = await this.ledgerRepo.find({ where: { companyId } });
    const projects = await this.projectRepo.find({ where: { companyId } });
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));

    const rows: {
      projectId: number;
      projectName: string;
      roomNo: string;
      customerName: string;
      arrearsMonths: number;
      arrearsAmount: number;
    }[] = [];
    for (const c of inScope) {
      const customerLedgers = ledgers.filter((l) => l.customerId === c.id);
      const totalBillable = this.tenantService ? this.monthsFromStart(c.feeStartDate) : 0;
      const paid = customerLedgers
        .filter((l) => l.status === 'effective' || l.status === 'pending')
        .reduce((s, l) => s + l.months, 0);
      const arrearsMonths = Math.max(0, totalBillable - paid);
      if (arrearsMonths > 0 && customerLedgers.length > 0) {
        const unitPrice = customerLedgers[customerLedgers.length - 1].unitPriceSnapshot;
        rows.push({
          projectId: c.projectId,
          projectName: projectMap.get(c.projectId) ?? '',
          roomNo: c.roomNo,
          customerName: c.name,
          arrearsMonths,
          arrearsAmount: Math.round((c.houseArea * unitPrice) / 100) * arrearsMonths,
        });
      }
    }
    return rows;
  }

  /** 应收/实收/优惠/押金专项统计 */
  async special(companyId: number, kind: 'receivable' | 'received' | 'discount' | 'deposit', startTime?: string, endTime?: string, projectIds?: number[]) {
    const qb = this.effectiveWhere(companyId, startTime, endTime, projectIds);
    if (kind === 'deposit') {
      qb.andWhere('r.chargeType = :type', { type: ChargeType.DELIVERY });
    }
    const orders = await qb.getMany();
    if (kind === 'receivable') {
      return orders.map((o) => ({ orderNo: o.orderNo, receivableAmount: o.receivableAmount, discountAmount: o.discountAmount, receivedAmount: o.receivedAmount }));
    }
    if (kind === 'received') {
      return orders.map((o) => ({ orderNo: o.orderNo, receivedAmount: o.receivedAmount, paidAt: o.paidAt }));
    }
    if (kind === 'discount') {
      return orders.filter((o) => o.discountAmount > 0).map((o) => ({ orderNo: o.orderNo, discountType: o.discountType, discountAmount: o.discountAmount }));
    }
    // deposit：押金统计 = 交房缴费中押金抵扣前的押金项（按项目维度汇总）
    const byProject = new Map<number, number>();
    for (const o of orders) {
      const snapshot = JSON.parse(o.payerSnapshot || '{}');
      const deposit = (snapshot.items ?? []).find((i: { feeItemCode: string }) => i.feeItemCode === 'DEPOSIT_DECORATION');
      byProject.set(o.projectId, (byProject.get(o.projectId) ?? 0) + (deposit?.amount ?? 0));
    }
    return [...byProject.entries()].map(([projectId, amount]) => ({ projectId, depositAmount: amount }));
  }

  private summarize(orders: ReceiptOrderEntity[]) {
    return {
      receivableAmount: orders.reduce((s, o) => s + o.receivableAmount, 0),
      receivedAmount: orders.reduce((s, o) => s + o.receivedAmount, 0),
      discountAmount: orders.reduce((s, o) => s + o.discountAmount, 0),
      depositAmount: orders
        .filter((o) => o.chargeType === ChargeType.DELIVERY)
        .reduce((s, o) => {
          const snapshot = JSON.parse(o.payerSnapshot || '{}');
          const deposit = (snapshot.items ?? []).find((i: { feeItemCode: string }) => i.feeItemCode === 'DEPOSIT_DECORATION');
          return s + (deposit?.amount ?? 0);
        }, 0),
      orderCount: orders.length,
    };
  }

  private monthsFromStart(feeStartDate: string, now: Date = new Date()): number {
    const startMonth = feeStartDate.slice(0, 7);
    const currentMonth = now.toISOString().slice(0, 7);
    const [sy, sm] = startMonth.split('-').map(Number);
    const [cy, cm] = currentMonth.split('-').map(Number);
    return Math.max(1, (cy * 12 + cm) - (sy * 12 + sm) + 1);
  }
}

void ErrorCodes;
void BusinessException;