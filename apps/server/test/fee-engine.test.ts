import { FeeCalculationService } from '../src/modules/fee-calculation/fee-calculation.service';
import { LedgerStatus } from '@pms/shared';

describe('费用计算引擎（纯函数 + 整数分运算）', () => {
  const service = new FeeCalculationService(null as never);
  const ctx = {
    depositAmount: 200000,
    decorationMgmtRate: 90,
    garbageTransportRate: 250,
    unitPrice: 120,
  };

  it('spec 5.3.1 规则 1a 标准示例：面积 100㎡、累计欠费 3 个月', () => {
    const items = service.calcDeliveryFees(10000, 3, ctx);
    expect(items[0].amount).toBe(200000); // 装修押金 2000 元
    expect(items[1].amount).toBe(9000); // 装修管理费 90 元（100×90×0.01）
    expect(items[2].amount).toBe(25000); // 垃圾清运费 250 元（100×2.5）
    expect(items[3].amount).toBe(36000); // 物业费 360 元（100×1.2×3）
    // 逐项带计算依据
    for (const item of items) {
      expect(item.calcBasis.length).toBeGreaterThan(0);
      expect(item.parameterSnapshot).toBeDefined();
    }
  });

  it('面积小数边界（33.33㎡）金额精确到分，无浮点误差', () => {
    const areaFen = 3333; // 33.33㎡
    const decoration = service.calcDecorationMgmt(areaFen, ctx);
    const garbage = service.calcGarbageTransport(areaFen, ctx);
    expect(decoration.amount).toBe(3000); // 3333×90/100 = 2999.7 → 四舍五入 3000 分
    expect(garbage.amount).toBe(8333); // 3333×250/100 = 8332.5 → 8333 分
    // 整数分运算（无小数残留）
    expect(Number.isInteger(decoration.amount)).toBe(true);
    expect(Number.isInteger(garbage.amount)).toBe(true);
  });

  it('物业费 = 面积百分位 × 单价分 ÷ 100 × 月数', () => {
    expect(service.calcPropertyFee(10000, 6, ctx).amount).toBe(72000); // 100×1.2×6 = 720 元
  });
});

describe('月段推导与重叠校验', () => {
  const service = new FeeCalculationService(null as never);
  const fakeLedgers = [
    { startMonth: '2026-01', endMonth: '2026-06', months: 6, status: LedgerStatus.EFFECTIVE },
  ] as never[];

  it('累计计费月数：起始月至当前月（含）', () => {
    expect(service.totalBillableMonths('2026-01-01', new Date('2026-11-23'))).toBe(11);
    expect(service.totalBillableMonths('2026-11-01', new Date('2026-11-23'))).toBe(1);
  });

  it('已缴费月数 = effective + pending 月段总和', () => {
    expect(service.paidMonths(fakeLedgers)).toBe(6);
  });

  it('剩余应交费月份 = max(0, 累计计费月数 − 已缴费月数)', () => {
    expect(service.remainingMonths('2026-01-01', fakeLedgers, new Date('2026-11-23'))).toBe(5);
    expect(service.remainingMonths('2026-01-01', fakeLedgers, new Date('2026-06-30'))).toBe(0);
  });

  it('最早未缴月推导', () => {
    expect(service.earliestUnpaidMonth('2026-01-01', fakeLedgers, new Date('2026-11-23'))).toBe('2026-07');
  });

  it('月段重叠校验：新月段与既有 pending+effective 重叠返回 true', () => {
    expect(FeeCalculationService.hasOverlap('2026-06', 3, fakeLedgers)).toBe(true);
    expect(FeeCalculationService.hasOverlap('2026-07', 3, fakeLedgers)).toBe(false);
  });

  it('月份运算 addMonths / monthDiff', () => {
    expect(FeeCalculationService.addMonths('2026-01', 11)).toBe('2026-12');
    expect(FeeCalculationService.addMonths('2026-12', 1)).toBe('2027-01');
    expect(FeeCalculationService.monthDiff('2026-01', '2026-12')).toBe(11);
  });
});

describe('优惠/抵扣/实收金额公式', () => {
  it('实收 = 应交 − 优惠 − 抵扣（整数分）', () => {
    const receivable = 366000;
    const discount = 5000;
    const deduct = 200000;
    expect(receivable - discount - deduct).toBe(161000);
  });
});