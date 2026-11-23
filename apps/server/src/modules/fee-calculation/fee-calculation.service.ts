import { Injectable } from '@nestjs/common';
import { FeeItemCode, FeeParameterCode, HouseStatus } from '@pms/shared';
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
  garbageTransportRate: number;
  unitPrice: number;
}

/**
 * 费用计算引擎：纯函数计算器 + 参数快照。
 * 全程整数（分）运算，仅最终金额一步四舍五入；
 * 面积以 0.01㎡ 百分位整数参与运算。
 */
@Injectable()
export class FeeCalculationService {
  constructor(private readonly feeParameterService: FeeParameterService) {}

  /** 解析当前生效参数并输出不可变参数上下文 */
  async resolveParameters(companyId: number, projectId?: number): Promise<ParameterContext> {
    const params = await this.feeParameterService.current(companyId, projectId);
    return {
      depositAmount: params[FeeParameterCode.DEPOSIT_DECORATION_AMOUNT],
      decorationMgmtRate: params[FeeParameterCode.DECORATION_MGMT_RATE],
      garbageTransportRate: params[FeeParameterCode.GARBAGE_TRANSPORT_RATE],
      unitPrice: params[FeeParameterCode.PROPERTY_FEE_UNIT_PRICE],
    };
  }

  snapshot(ctx: ParameterContext): Record<string, number> {
    return {
      DEPOSIT_DECORATION_AMOUNT: ctx.depositAmount,
      DECORATION_MGMT_RATE: ctx.decorationMgmtRate,
      GARBAGE_TRANSPORT_RATE: ctx.garbageTransportRate,
      PROPERTY_FEE_UNIT_PRICE: ctx.unitPrice,
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

  /** 装修管理费：面积 × 90 × 0.01 元（面积百分位 × rate 分 ÷ 100） */
  calcDecorationMgmt(areaFen: number, ctx: ParameterContext): FeeCalcResult {
    const amount = Math.round((areaFen * ctx.decorationMgmtRate) / 100);
    return {
      feeItemCode: FeeItemCode.DECORATION_MGMT,
      amount,
      calcBasis: `${(areaFen / 100).toFixed(2)}㎡ × ${ctx.decorationMgmtRate}分/㎡ = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /** 垃圾清运费：面积 × 2.5 元（面积百分位 × rate 分 ÷ 100） */
  calcGarbageTransport(areaFen: number, ctx: ParameterContext): FeeCalcResult {
    const amount = Math.round((areaFen * ctx.garbageTransportRate) / 100);
    return {
      feeItemCode: FeeItemCode.GARBAGE_TRANSPORT,
      amount,
      calcBasis: `${(areaFen / 100).toFixed(2)}㎡ × ${ctx.garbageTransportRate}分/㎡ = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /** 物业费：面积 × 单价 × 累计欠费月份（面积百分位 × 单价分 ÷ 100 × 月数） */
  calcPropertyFee(areaFen: number, months: number, ctx: ParameterContext): FeeCalcResult {
    const amount = Math.round((areaFen * ctx.unitPrice) / 100) * months;
    return {
      feeItemCode: FeeItemCode.PROPERTY_FEE,
      amount,
      calcBasis: `${(areaFen / 100).toFixed(2)}㎡ × ${ctx.unitPrice}分/㎡/月 × ${months}个月 = ${(amount / 100).toFixed(2)}元`,
      parameterSnapshot: this.snapshot(ctx),
    };
  }

  /** 交房四项费用（面积百分位入参，spec 5.3.1 规则 1） */
  calcDeliveryFees(areaFen: number, arrearsMonths: number, ctx: ParameterContext): FeeCalcResult[] {
    return [
      this.calcDepositDeposit(ctx),
      this.calcDecorationMgmt(areaFen, ctx),
      this.calcGarbageTransport(areaFen, ctx),
      this.calcPropertyFee(areaFen, arrearsMonths, ctx),
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

  /** 已缴费月数：effective + pending 月段总和 */
  paidMonths(ledgers: PropertyFeeLedgerEntity[]): number {
    return ledgers
      .filter((l) => l.status === 'effective' || l.status === 'pending')
      .reduce((sum, l) => sum + l.months, 0);
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
    // 已交房且有台账：剩余应交费月份
    if (customer.houseStatus !== HouseStatus.UNDELIVERED && ledgers.length > 0) {
      return this.remainingMonths(customer.feeStartDate, ledgers, now);
    }
    // 未交房/无台账：从物业费起始月推导至当前月
    return this.remainingMonths(customer.feeStartDate, ledgers, now);
  }
}