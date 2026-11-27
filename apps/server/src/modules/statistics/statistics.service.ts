import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChargeType, CHARGE_TYPE_LABELS, ErrorCodes, FEE_ITEM_LABELS, FeeItemCode, ReceiptStatus } from '@pms/shared';
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

  private normalizeEndTime(endTime?: string) {
    if (!endTime) return endTime;
    if (/^\d{4}-\d{2}-\d{2}$/.test(endTime)) return `${endTime}T23:59:59.999`;
    return endTime;
  }

  private effectiveWhere(companyId: number, startTime?: string, endTime?: string, projectIds?: number[]) {
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .where('r.companyId = :companyId', { companyId })
      .andWhere('r.status = :status', { status: ReceiptStatus.EFFECTIVE });
    if (startTime) qb.andWhere('r.createdAt >= :startTime', { startTime });
    const end = this.normalizeEndTime(endTime);
    if (end) qb.andWhere('r.createdAt <= :endTime', { endTime: end });
    const scoped = this.scopedProjectIds(companyId, projectIds);
    if (scoped.length > 0) qb.andWhere('r.projectId IN (:...scoped)', { scoped });
    else if (scoped.length === 0 && !this.tenantService.get()?.allProjectsScope && !projectIds?.length) {
      // 无项目权限且未指定项目：空结果
      qb.andWhere('1 = 0');
    }
    return qb;
  }

  private categoryLabel(code: string): string {
    if (code.startsWith('OTHER:')) {
      const raw = code.slice(6);
      return `其他·${FEE_ITEM_LABELS[raw as FeeItemCode] ?? raw}`;
    }
    return FEE_ITEM_LABELS[code as FeeItemCode] ?? code;
  }

  /**
   * 财务工作台：按项目 + 日/月粒度的收费汇总、分类汇总与明细。
   * grain=day 按自然日；grain=month 按自然月。
   */
  async financeOverview(
    companyId: number,
    opts: { startTime?: string; endTime?: string; projectIds?: number[]; grain?: 'day' | 'month' } = {},
  ) {
    const grain = opts.grain === 'month' ? 'month' : 'day';
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const startTime =
      opts.startTime ??
      (grain === 'day' ? `${y}-${m}-01` : `${y}-01-01`);
    const endTime = opts.endTime ?? `${y}-${m}-${d}`;

    const orders = await this.effectiveWhere(companyId, startTime, endTime, opts.projectIds)
      .orderBy('r.createdAt', 'DESC')
      .getMany();

    const allProjects = await this.projectRepo.find({ where: { companyId } });
    const scopedIds = this.scopedProjectIds(companyId, opts.projectIds);
    const tenant = this.tenantService.get();
    const visibleProjects =
      scopedIds.length > 0
        ? allProjects.filter((p) => scopedIds.includes(p.id))
        : tenant?.allProjectsScope
          ? allProjects
          : [];
    const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));

    const byProjectMap = new Map<number, ReceiptOrderEntity[]>();
    const byPeriodMap = new Map<string, ReceiptOrderEntity[]>();
    for (const o of orders) {
      if (!byProjectMap.has(o.projectId)) byProjectMap.set(o.projectId, []);
      byProjectMap.get(o.projectId)!.push(o);
      const at = this.createdAtText(o.createdAt);
      const period = grain === 'day' ? at.slice(0, 10) : at.slice(0, 7);
      if (!period) continue;
      if (!byPeriodMap.has(period)) byPeriodMap.set(period, []);
      byPeriodMap.get(period)!.push(o);
    }

    const byProject = [...byProjectMap.entries()]
      .map(([projectId, list]) => ({
        projectId,
        projectName: projectMap.get(projectId) ?? `项目${projectId}`,
        ...this.summarize(list),
      }))
      .sort((a, b) => b.receivedAmount - a.receivedAmount);

    const periodKeys = this.fillPeriods(startTime, endTime, grain);
    const byPeriod = periodKeys.map((period) => ({
      period,
      ...this.summarize(byPeriodMap.get(period) ?? []),
    }));

    let byCategory: {
      category: string;
      categoryLabel: string;
      receivableAmount: number;
      receivedAmount: number;
      discountAmount: number;
      orderCount: number;
    }[] = [];
    if (orders.length > 0) {
      const items = await this.itemRepo
        .createQueryBuilder('i')
        .where('i.orderId IN (:...orderIds)', { orderIds: orders.map((o) => o.id) })
        .getMany();
      const orderMap = new Map(orders.map((o) => [o.id, o]));
      const catMap = new Map<string, { receivable: number; received: number; discount: number; count: number }>();
      for (const item of items) {
        const order = orderMap.get(item.orderId);
        if (!order) continue;
        const category = item.feeCategoryRef ? `OTHER:${item.feeItemCode}` : String(item.feeItemCode);
        const entry = catMap.get(category) ?? { receivable: 0, received: 0, discount: 0, count: 0 };
        entry.receivable += item.amount;
        entry.received += item.amount;
        entry.count += 1;
        catMap.set(category, entry);
      }
      byCategory = [...catMap.entries()]
        .map(([category, v]) => ({
          category,
          categoryLabel: this.categoryLabel(category),
          receivableAmount: v.receivable,
          receivedAmount: v.received,
          discountAmount: v.discount,
          orderCount: v.count,
        }))
        .sort((a, b) => b.receivedAmount - a.receivedAmount);
    }

    const details = orders.slice(0, 100).map((o) => {
      let roomNo = '';
      let customerName = '';
      try {
        const snap = JSON.parse(o.snapshotJson || '{}');
        roomNo = snap.roomNo ?? '';
        customerName = snap.customerName ?? snap.name ?? '';
      } catch {
        /* ignore */
      }
      try {
        if (!customerName) {
          const payer = JSON.parse(o.payerSnapshot || '{}');
          customerName = payer.customerName ?? '';
          roomNo = roomNo || payer.roomNo || '';
        }
      } catch {
        /* ignore */
      }
      return {
        orderNo: o.orderNo,
        projectId: o.projectId,
        projectName: projectMap.get(o.projectId) ?? '',
        roomNo,
        customerName,
        chargeType: o.chargeType,
        chargeTypeLabel: CHARGE_TYPE_LABELS[o.chargeType] ?? o.chargeType,
        paidAt: o.paidAt ?? o.createdAt,
        createdAt: o.createdAt,
        receivableAmount: o.receivableAmount,
        receivedAmount: o.receivedAmount,
        discountAmount: o.discountAmount,
      };
    });

    return {
      grain,
      startTime,
      endTime,
      projects: visibleProjects.map((p) => ({ id: p.id, name: p.name, address: p.address })),
      summary: this.summarize(orders),
      byProject,
      byPeriod,
      byCategory,
      details,
    };
  }

  private fillPeriods(startTime: string, endTime: string, grain: 'day' | 'month'): string[] {
    const start = startTime.slice(0, 10);
    const end = endTime.slice(0, 10);
    const keys: string[] = [];
    if (grain === 'month') {
      let [y, m] = start.slice(0, 7).split('-').map(Number);
      const [ey, em] = end.slice(0, 7).split('-').map(Number);
      while (y < ey || (y === ey && m <= em)) {
        keys.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return keys;
    }
    const cur = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    while (cur <= last) {
      const yy = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      keys.push(`${yy}-${mm}-${dd}`);
      cur.setDate(cur.getDate() + 1);
    }
    return keys;
  }

  /** 月度统计（自然月应收/实收/优惠/押金汇总） */
  async monthly(companyId: number, startTime?: string, endTime?: string, projectIds?: number[]) {
    const qb = this.effectiveWhere(companyId, startTime, endTime, projectIds);
    const orders = await qb.getMany();
    return this.summarize(orders);
  }

  /** 把 createdAt（string | Date）规范成可切片的 ISO 字符串 */
  private createdAtText(value: string | Date | null | undefined): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    const s = String(value).trim();
    // SQLite 常见 "YYYY-MM-DD HH:mm:ss" → 统一成可切片格式
    return s.includes(' ') ? s.replace(' ', 'T') : s;
  }

  /** 年度统计（各月汇总 + 年度合计） */
  async yearly(companyId: number, year: string, projectIds?: number[]) {
    const y = /^\d{4}$/.test(String(year)) ? String(year) : String(new Date().getFullYear());
    const startTime = `${y}-01-01`;
    const endTime = `${y}-12-31`;
    const orders = await this.effectiveWhere(companyId, startTime, endTime, projectIds).getMany();
    const byMonth = new Map<string, typeof orders>();
    for (const o of orders) {
      const month = this.createdAtText(o.createdAt).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month)!.push(o);
    }
    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, list]) => ({ month, summary: this.summarize(list) }));
    return { year: y, months, total: this.summarize(orders) };
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
      categoryLabel: this.categoryLabel(category),
      receivableAmount: v.receivable,
      receivedAmount: v.received,
      discountAmount: v.discount,
      orderCount: v.count,
    }));
  }

  /**
   * 欠费统计：按物业费起始日 → 统计截止月，对照已缴台账推算欠费月数与金额（首月非 1 号按天折算）。
   * asOf=YYYY-MM 统计截止月，默认当月。
   */
  async arrears(companyId: number, projectIds?: number[], asOf?: string) {
    const scoped = this.scopedProjectIds(companyId, projectIds);
    const customers = await this.customerRepo.find({ where: { companyId } });
    const scopedSet = new Set(scoped);
    const inScope = scopedSet.size > 0 ? customers.filter((c) => scopedSet.has(c.projectId)) : (this.tenantService.get()?.allProjectsScope ? customers : []);
    const ledgers = await this.ledgerRepo.find({ where: { companyId } });
    const projects = await this.projectRepo.find({ where: { companyId } });
    const projectMap = new Map(projects.map((p) => [p.id, p.name]));
    const asOfMonth = asOf && /^\d{4}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 7);

    const rows: {
      projectId: number;
      projectName: string;
      roomNo: string;
      customerName: string;
      feeStartDate: string;
      feeEndMonth: string;
      totalBillableMonths: number;
      paidMonths: number;
      arrearsMonths: number;
      arrearsAmount: number;
      asOfMonth: string;
    }[] = [];
    for (const c of inScope) {
      if (c.deletedAt) continue;
      const customerLedgers = ledgers.filter((l) => l.customerId === c.id);
      const totalBillable = this.monthsFromStartTo(c.feeStartDate, asOfMonth);
      const paid = this.paidMonthsUpTo(customerLedgers, asOfMonth);
      const arrearsMonths = Math.max(0, totalBillable - paid);
      if (arrearsMonths <= 0) continue;
      const unitPrice =
        customerLedgers.length > 0
          ? customerLedgers[customerLedgers.length - 1].unitPriceSnapshot
          : 120;
      const unpaidStart = this.earliestUnpaidMonth(c.feeStartDate, customerLedgers, asOfMonth);
      const arrearsAmount = this.calcArrearsAmount(
        c.houseArea,
        c.feeStartDate,
        unpaidStart,
        arrearsMonths,
        unitPrice,
      );
      rows.push({
        projectId: c.projectId,
        projectName: projectMap.get(c.projectId) ?? '',
        roomNo: c.roomNo,
        customerName: c.name,
        feeStartDate: c.feeStartDate,
        feeEndMonth: asOfMonth,
        totalBillableMonths: totalBillable,
        paidMonths: paid,
        arrearsMonths,
        arrearsAmount,
        asOfMonth,
      });
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
      const snapshot = this.parsePayerSnapshot(o.payerSnapshot);
      const deposit = (snapshot.items ?? []).find((i) => i.feeItemCode === 'DEPOSIT_DECORATION');
      byProject.set(o.projectId, (byProject.get(o.projectId) ?? 0) + Number(deposit?.amount ?? 0));
    }
    return [...byProject.entries()].map(([projectId, amount]) => ({ projectId, depositAmount: amount }));
  }

  private parsePayerSnapshot(raw?: string | null): { items?: { feeItemCode: string; amount?: number }[] } {
    if (!raw) return {};
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private summarize(orders: ReceiptOrderEntity[]) {
    return {
      receivableAmount: orders.reduce((s, o) => s + Number(o.receivableAmount || 0), 0),
      receivedAmount: orders.reduce((s, o) => s + Number(o.receivedAmount || 0), 0),
      discountAmount: orders.reduce((s, o) => s + Number(o.discountAmount || 0), 0),
      depositAmount: orders
        .filter((o) => o.chargeType === ChargeType.DELIVERY)
        .reduce((s, o) => {
          const snapshot = this.parsePayerSnapshot(o.payerSnapshot);
          const deposit = (snapshot.items ?? []).find((i) => i.feeItemCode === 'DEPOSIT_DECORATION');
          return s + Number(deposit?.amount ?? 0);
        }, 0),
      orderCount: orders.length,
    };
  }

  private monthsFromStart(feeStartDate: string, now: Date = new Date()): number {
    return this.monthsFromStartTo(feeStartDate, now.toISOString().slice(0, 7));
  }

  private monthsFromStartTo(feeStartDate: string, asOfMonth: string): number {
    if (!feeStartDate || !asOfMonth) return 0;
    const startMonth = String(feeStartDate).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(asOfMonth)) return 0;
    const [sy, sm] = startMonth.split('-').map(Number);
    const [cy, cm] = asOfMonth.split('-').map(Number);
    return Math.max(0, cy * 12 + cm - (sy * 12 + sm) + 1);
  }

  private paidMonthsUpTo(ledgers: PropertyFeeLedgerEntity[], asOfMonth: string): number {
    const addMonths = (month: string, n: number) => {
      const [y, m] = month.split('-').map(Number);
      const total = y * 12 + (m - 1) + n;
      return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
    };
    const cmp = (a: string, b: string) => {
      const [ay, am] = a.split('-').map(Number);
      const [by, bm] = b.split('-').map(Number);
      return ay * 12 + am - (by * 12 + bm);
    };
    let count = 0;
    for (const l of ledgers.filter((x) => x.status === 'effective' || x.status === 'pending')) {
      let cursor = l.startMonth;
      for (let i = 0; i < l.months; i++) {
        if (cmp(asOfMonth, cursor) >= 0) count += 1;
        cursor = addMonths(cursor, 1);
      }
    }
    return count;
  }

  private addMonths(month: string, n: number): string {
    const [y, m] = month.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
  }

  private earliestUnpaidMonth(
    feeStartDate: string,
    ledgers: PropertyFeeLedgerEntity[],
    asOfMonth: string,
  ): string {
    const startMonth = feeStartDate.slice(0, 7);
    const covered = new Set<string>();
    for (const l of ledgers.filter((x) => x.status === 'effective' || x.status === 'pending')) {
      let cursor = l.startMonth;
      for (let i = 0; i < l.months; i++) {
        covered.add(cursor);
        cursor = this.addMonths(cursor, 1);
      }
    }
    let cursor = startMonth;
    while (this.monthCmp(cursor, asOfMonth) <= 0) {
      if (!covered.has(cursor)) return cursor;
      cursor = this.addMonths(cursor, 1);
    }
    return cursor;
  }

  private monthCmp(a: string, b: string): number {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return ay * 12 + am - (by * 12 + bm);
  }

  /** 欠费金额：首月非 1 号按天折算，其余整月全额 */
  private calcArrearsAmount(
    areaFen: number,
    feeStartDate: string,
    unpaidStartMonth: string,
    arrearsMonths: number,
    unitPrice: number,
  ): number {
    if (arrearsMonths <= 0) return 0;
    const monthly = Math.round((areaFen * unitPrice) / 100);
    const feeStartMonth = feeStartDate.slice(0, 7);
    const startDay = Number(feeStartDate.slice(8, 10)) || 1;
    let total = 0;
    for (let i = 0; i < arrearsMonths; i++) {
      const month = this.addMonths(unpaidStartMonth, i);
      if (month === feeStartMonth && startDay > 1) {
        const [y, m] = month.split('-').map(Number);
        const dim = new Date(y, m, 0).getDate();
        const days = dim - startDay + 1;
        total += Math.round((monthly * days) / dim);
      } else {
        total += monthly;
      }
    }
    return total;
  }
}

void ErrorCodes;
void BusinessException;