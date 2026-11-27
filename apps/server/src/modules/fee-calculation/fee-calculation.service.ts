import { Injectable } from '@nestjs/common';
import {
  FeeItemCode,
  FeeParameterCode,
  HouseStatus,
  PropertyType,
  isCommercialProperty,
  normalizePropertyType,
  PROPERTY_TYPE_LABELS,
} from '@pms/shared';
import { FeeParameterService } from '../fee-parameter/fee-parameter.service';
import { PropertyFeeLedgerEntity } from '../../database/entities/charging-entities';
import { CustomerEntity } from '../../database/entities/org-entities';

export interface FeeCalcResult {
  feeItemCode: FeeItemCode;
  amount: number;
  calcBasis: string;
  parameterSnapshot: Record<string, number>;
}

/** 参数上下文（不可变快照） */
export interface ParameterContext {
  depositAmount: number;
  decorationMgmtRate: number;
  decorationMgmtRateResidential: number;
  decorationMgmtRateCommercial: number;
  garbageTransportRate: number;
  /** 当前选用的物业费单价 */
  unitPrice: number;
  unitPriceResidential: number;
  unitPriceCommercialL1: number;
  unitPriceCommercialL2: number;
  propertyType: PropertyType;
}

/**
 * 费用计算引擎：纯函数计算器 + 参数快照。
 * 全程整数（分）运算，仅最终金额一步四舍五入；
 * 面积以 0.01㎡ 百分位整数参与运算。
 *
 * 门面与住房口径不同：
 * - 住房物业费：面积 × 住房单价 × 月数
 * - 门面一楼：面积 × 2 × 月数；门面二楼：面积 × 0.7 × 月数
 * - 垃圾清运：面积 × 2.5（住房/门面相同）
 * - 住房装修管理费：面积 × 90 × 0.02；门面：面积 × 0.01 × 90
 */
@Injectable()
export class FeeCalculationService {
  constructor(private readonly feeParameterService: FeeParameterService) {}

  /** 解析当前生效参数；propertyType 决定住房/门面楼层单价与装修管理费 */
  async resolveParameters(
    companyId: number,
    projectId?: number,
    propertyType: PropertyType | string = PropertyType.RESIDENTIAL,
  ): Promise<ParameterContext> {
    const params = await this.feeParameterService.current(companyId, projectId);
    const unitPriceResidential = params[FeeParameterCode.PROPERTY_FEE_UNIT_PRICE];
    const unitPriceCommercialL1 =
      params[FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL] ?? unitPriceResidential;
    const unitPriceCommercialL2 =
      params[FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2] ?? 70;
    const decorationMgmtRateResidential = params[FeeParameterCode.DECORATION_MGMT_RATE];
    const decorationMgmtRateCommercial =
      params[FeeParameterCode.DECORATION_MGMT_RATE_COMMERCIAL] ?? 90;

    const type = normalizePropertyType(propertyType);
    let unitPrice = unitPriceResidential;
    let decorationMgmtRate = decorationMgmtRateResidential;
    if (type === PropertyType.COMMERCIAL_L1) {
      unitPrice = unitPriceCommercialL1;
      decorationMgmtRate = decorationMgmtRateCommercial;
    } else if (type === PropertyType.COMMERCIAL_L2) {
      unitPrice = unitPriceCommercialL2;
      decorationMgmtRate = decorationMgmtRateCommercial;
    }

    return {
      depositAmount: params[FeeParameterCode.DEPOSIT_DECORATION_AMOUNT],
      decorationMgmtRate,
      decorationMgmtRateResidential,
      decorationMgmtRateCommercial,
      garbageTransportRate: params[FeeParameterCode.GARBAGE_TRANSPORT_RATE],
      unitPrice,
      unitPriceResidential,
      unitPriceCommercialL1,
      unitPriceCommercialL2,
      propertyType: type,
    };
  }

  snapshot(ctx: ParameterContext): Record<string, number> {
    return {
      DEPOSIT_DECORATION_AMOUNT: ctx.depositAmount,
      DECORATION_MGMT_RATE: ctx.decorationMgmtRateResidential,
      DECORATION_MGMT_RATE_COMMERCIAL: ctx.decorationMgmtRateCommercial,
      GARBAGE_TRANSPORT_RATE: ctx.garbageTransportRate,
      PROPERTY_FEE_UNIT_PRICE: ctx.unitPriceResidential,
      PROPERTY_FEE_UNIT_PRICE_COMMERCIAL: ctx.unitPriceCommercialL1,
      PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2: ctx.unitPriceCommercialL2,
      UNIT_PRICE_APPLIED: ctx.unitPrice,
      DECORATION_RATE_APPLIED: ctx.decorationMgmtRate,
    };
  }

  /** 装修押金：固定金额 */
  calcDepositDeposit(ctx: ParameterContext): FeeCalcResult {
    return {
      feeItemCode: FeeItemCode.DEPOSIT_DECORATION,
      amount: ctx.depositAmount,
      calcBasis: `装修押金固定 ${ctx.depositAmount / 100} 元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /**
   * 装修管理费：
   * - 住房：面积 × 90 × 0.02 = 面积 × 1.8 元/㎡
   * - 门面：面积 × 0.01 × 90 = 面积 × 0.9 元/㎡
   */
  calcDecorationMgmt(areaFen: number, ctx: ParameterContext): FeeCalcResult {
    const amount = Math.round((areaFen * ctx.decorationMgmtRate) / 100);
    const area = (areaFen / 100).toFixed(2);
    const yuanPerSqm = (ctx.decorationMgmtRate / 100).toFixed(2);
    const formula = isCommercialProperty(ctx.propertyType)
      ? `${area}㎡ × 0.01 × 90（即 ${yuanPerSqm} 元/㎡，门面）`
      : `${area}㎡ × 90 × 0.02（即 ${yuanPerSqm} 元/㎡，住房）`;
    return {
      feeItemCode: FeeItemCode.DECORATION_MGMT,
      amount,
      calcBasis: `${formula} = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /** 垃圾清运费：面积 × 2.5 元（住房/门面相同） */
  calcGarbageTransport(areaFen: number, ctx: ParameterContext): FeeCalcResult {
    const amount = Math.round((areaFen * ctx.garbageTransportRate) / 100);
    return {
      feeItemCode: FeeItemCode.GARBAGE_TRANSPORT,
      amount,
      calcBasis: `${(areaFen / 100).toFixed(2)}㎡ × 2.5 元/㎡ = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /** 物业费：面积 × 单价 × 月数（住房 / 门面一楼×2 / 门面二楼×0.7）；整月口径 */
  calcPropertyFee(areaFen: number, months: number, ctx: ParameterContext): FeeCalcResult {
    const amount = Math.round((areaFen * ctx.unitPrice) / 100) * months;
    const typeLabel = PROPERTY_TYPE_LABELS[ctx.propertyType] ?? '住房';
    const rateHint =
      ctx.propertyType === PropertyType.COMMERCIAL_L1
        ? '面积×2'
        : ctx.propertyType === PropertyType.COMMERCIAL_L2
          ? '面积×0.7'
          : `${(ctx.unitPrice / 100).toFixed(2)}元/㎡/月`;
    return {
      feeItemCode: FeeItemCode.PROPERTY_FEE,
      amount,
      calcBasis: `${(areaFen / 100).toFixed(2)}㎡ × ${(ctx.unitPrice / 100).toFixed(2)}元/㎡/月（${typeLabel}，${rateHint}）× ${months}个月 = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /** 当月天数 */
  static daysInMonth(year: number, month1to12: number): number {
    return new Date(year, month1to12, 0).getDate();
  }

  /** 月租金（分）= round(面积百分位 × 单价分 / 100) */
  monthlyPropertyAmount(areaFen: number, ctx: ParameterContext): number {
    return Math.round((areaFen * ctx.unitPrice) / 100);
  }

  /**
   * 按自然日精确计物业费（起止含当日）。
   * 起始日非 1 号时首月按剩余天数/当月天数折算；截止日非月末时末月按已过天数折算；中间整月全额。
   */
  calcPropertyFeeByDateRange(
    areaFen: number,
    startDate: string,
    endDate: string,
    ctx: ParameterContext,
  ): FeeCalcResult {
    const start = FeeCalculationService.parseYmd(startDate);
    const end = FeeCalculationService.parseYmd(endDate);
    if (!start || !end || end < start) {
      return this.calcPropertyFee(areaFen, 0, ctx);
    }
    const monthly = this.monthlyPropertyAmount(areaFen, ctx);
    let amount = 0;
    const parts: string[] = [];
    let cursorY = start.y;
    let cursorM = start.m;
    while (cursorY < end.y || (cursorY === end.y && cursorM <= end.m)) {
      const dim = FeeCalculationService.daysInMonth(cursorY, cursorM);
      const isFirst = cursorY === start.y && cursorM === start.m;
      const isLast = cursorY === end.y && cursorM === end.m;
      let fromDay = 1;
      let toDay = dim;
      if (isFirst) fromDay = start.d;
      if (isLast) toDay = end.d;
      const days = Math.max(0, toDay - fromDay + 1);
      if (days <= 0) {
        // skip
      } else if (days === dim) {
        amount += monthly;
        parts.push(`${cursorY}-${String(cursorM).padStart(2, '0')}整月`);
      } else {
        const part = Math.round((monthly * days) / dim);
        amount += part;
        parts.push(
          `${cursorY}-${String(cursorM).padStart(2, '0')} ${fromDay}~${toDay}日(${days}/${dim})=${(part / 100).toFixed(2)}元`,
        );
      }
      cursorM += 1;
      if (cursorM > 12) {
        cursorM = 1;
        cursorY += 1;
      }
    }
    const typeLabel = PROPERTY_TYPE_LABELS[ctx.propertyType] ?? '住房';
    const monthHint = parts.length <= 4 ? parts.join('；') : `${parts[0]} … 共${parts.length}段`;
    return {
      feeItemCode: FeeItemCode.PROPERTY_FEE,
      amount,
      calcBasis: `${(areaFen / 100).toFixed(2)}㎡ × ${(ctx.unitPrice / 100).toFixed(2)}元/㎡/月（${typeLabel}）按天：${startDate}~${endDate}；${monthHint} = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /**
   * 续费/欠费：从某起缴月起缴 N 个整月；若覆盖物业费起始月且起始日非 1 号，首月按天折算。
   */
  calcPropertyFeeMonthsWithProration(
    areaFen: number,
    startMonth: string,
    months: number,
    feeStartDate: string,
    ctx: ParameterContext,
  ): FeeCalcResult {
    if (months <= 0) return this.calcPropertyFee(areaFen, 0, ctx);
    const endMonth = FeeCalculationService.addMonths(startMonth, months - 1);
    const feeStartMonth = FeeCalculationService.monthOf(feeStartDate);
    const startDay = Number(feeStartDate.slice(8, 10)) || 1;
    const rangeStart =
      startMonth === feeStartMonth && startDay > 1
        ? feeStartDate
        : `${startMonth}-01`;
    const [ey, em] = endMonth.split('-').map(Number);
    const rangeEnd = `${endMonth}-${String(FeeCalculationService.daysInMonth(ey, em)).padStart(2, '0')}`;
    if (startMonth === feeStartMonth && startDay > 1) {
      return this.calcPropertyFeeByDateRange(areaFen, rangeStart, rangeEnd, ctx);
    }
    return this.calcPropertyFee(areaFen, months, ctx);
  }

  static parseYmd(date: string): { y: number; m: number; d: number } | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.slice(0, 10));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  /** 某月最后一天 YYYY-MM-DD */
  static lastDayOfMonth(month: string): string {
    const [y, m] = month.split('-').map(Number);
    const d = FeeCalculationService.daysInMonth(y, m);
    return `${month}-${String(d).padStart(2, '0')}`;
  }

  /** 交房四项费用：物业费按起始日~截止月末按天精确 */
  calcDeliveryFees(
    areaFen: number,
    arrearsMonths: number,
    ctx: ParameterContext,
    feeStartDate?: string,
  ): FeeCalcResult[] {
    const property =
      feeStartDate && arrearsMonths > 0
        ? this.calcPropertyFeeMonthsWithProration(
            areaFen,
            FeeCalculationService.monthOf(feeStartDate),
            arrearsMonths,
            feeStartDate,
            ctx,
          )
        : this.calcPropertyFee(areaFen, arrearsMonths, ctx);
    return [
      this.calcDepositDeposit(ctx),
      this.calcDecorationMgmt(areaFen, ctx),
      this.calcGarbageTransport(areaFen, ctx),
      property,
    ];
  }

  /* ============ 月段台账推导（design 2.6.3） ============ */

  /** YYYY-MM 月份运算 */
  static monthOf(date: string): string {
    return date.slice(0, 7);
  }

  static addMonths(month: string, n: number): string {
    const [y, m] = month.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
  }

  static monthDiff(from: string, to: string): number {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    return ty * 12 + tm - (fy * 12 + fm);
  }

  /** 累计计费月数：物业费起始月至当前月（含） */
  totalBillableMonths(feeStartDate: string, now: Date = new Date()): number {
    const startMonth = FeeCalculationService.monthOf(feeStartDate);
    const currentMonth = FeeCalculationService.monthOf(now.toISOString());
    return Math.max(1, FeeCalculationService.monthDiff(startMonth, currentMonth) + 1);
  }

  /** 累计计费月数：起始月至 asOfMonth（YYYY-MM，含） */
  totalBillableMonthsAsOf(feeStartDate: string, asOfMonth: string): number {
    const startMonth = FeeCalculationService.monthOf(feeStartDate);
    return Math.max(0, FeeCalculationService.monthDiff(startMonth, asOfMonth) + 1);
  }

  /** 已缴费月数：effective + pending 月段总和 */
  paidMonths(ledgers: PropertyFeeLedgerEntity[]): number {
    return ledgers
      .filter((l) => l.status === 'effective' || l.status === 'pending')
      .reduce((sum, l) => sum + l.months, 0);
  }

  /** 截至 asOfMonth（含）已覆盖的缴费月数 */
  paidMonthsUpTo(ledgers: PropertyFeeLedgerEntity[], asOfMonth: string): number {
    let count = 0;
    for (const l of ledgers.filter((x) => x.status === 'effective' || x.status === 'pending')) {
      let cursor = l.startMonth;
      for (let i = 0; i < l.months; i++) {
        if (FeeCalculationService.monthDiff(cursor, asOfMonth) >= 0) count += 1;
        cursor = FeeCalculationService.addMonths(cursor, 1);
      }
    }
    return count;
  }

  /**
   * 剩余应交费月份 / 累计欠费月份推导：
   * 剩余 = max(0, 累计计费月数 − 已缴费月数)；欠费月份 = 剩余（截至当前月）。
   */
  remainingMonths(feeStartDate: string, ledgers: PropertyFeeLedgerEntity[], now: Date = new Date()): number {
    return Math.max(0, this.totalBillableMonths(feeStartDate, now) - this.paidMonths(ledgers));
  }

  /** 最早未缴月（续费默认起缴月） */
  earliestUnpaidMonth(feeStartDate: string, ledgers: PropertyFeeLedgerEntity[], now: Date = new Date()): string {
    const startMonth = FeeCalculationService.monthOf(feeStartDate);
    const currentMonth = FeeCalculationService.monthOf(now.toISOString());
    const covered = new Set<string>();
    for (const l of ledgers.filter((x) => x.status === 'effective' || x.status === 'pending')) {
      let cursor = l.startMonth;
      for (let i = 0; i < l.months; i++) {
        covered.add(cursor);
        cursor = FeeCalculationService.addMonths(cursor, 1);
      }
    }
    let cursor = startMonth;
    while (FeeCalculationService.monthDiff(cursor, currentMonth) >= 0) {
      if (!covered.has(cursor)) return cursor;
      cursor = FeeCalculationService.addMonths(cursor, 1);
    }
    return cursor;
  }

  /** 月段与既有 pending+effective 月段是否重叠 */
  static hasOverlap(month: string, months: number, ledgers: PropertyFeeLedgerEntity[]): boolean {
    const newMonths = new Set<string>();
    let cursor = month;
    for (let i = 0; i < months; i++) {
      newMonths.add(cursor);
      cursor = FeeCalculationService.addMonths(cursor, 1);
    }
    for (const l of ledgers.filter((x) => x.status === 'effective' || x.status === 'pending')) {
      let m = l.startMonth;
      for (let i = 0; i < l.months; i++) {
        if (newMonths.has(m)) return true;
        m = FeeCalculationService.addMonths(m, 1);
      }
    }
    return false;
  }

  /** 交房缴费的累计欠费月份数（无台账客户按起始时间推导） */
  arrearsMonthsFor(customer: CustomerEntity, ledgers: PropertyFeeLedgerEntity[], now: Date = new Date()): number {
    if (customer.houseStatus !== HouseStatus.UNDELIVERED && ledgers.length > 0) {
      return this.remainingMonths(customer.feeStartDate, ledgers, now);
    }
    return this.remainingMonths(customer.feeStartDate, ledgers, now);
  }
}
