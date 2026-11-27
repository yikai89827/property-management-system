import { FeeCalculationService, ParameterContext } from '../src/modules/fee-calculation/fee-calculation.service';
import { LedgerStatus, PropertyType } from '@pms/shared';

function makeCtx(partial: Partial<ParameterContext> = {}): ParameterContext {
  const unitPriceResidential = partial.unitPriceResidential ?? 120;
  const unitPriceCommercialL1 = partial.unitPriceCommercialL1 ?? 200;
  const unitPriceCommercialL2 = partial.unitPriceCommercialL2 ?? 70;
  const decorationMgmtRateResidential = partial.decorationMgmtRateResidential ?? 180;
  const decorationMgmtRateCommercial = partial.decorationMgmtRateCommercial ?? 90;
  const propertyType = partial.propertyType ?? PropertyType.RESIDENTIAL;
  const unitPrice =
    partial.unitPrice ??
    (propertyType === PropertyType.COMMERCIAL_L1
      ? unitPriceCommercialL1
      : propertyType === PropertyType.COMMERCIAL_L2
        ? unitPriceCommercialL2
        : unitPriceResidential);
  const decorationMgmtRate =
    partial.decorationMgmtRate ??
    (propertyType === PropertyType.COMMERCIAL_L1 || propertyType === PropertyType.COMMERCIAL_L2
      ? decorationMgmtRateCommercial
      : decorationMgmtRateResidential);
  return {
    depositAmount: partial.depositAmount ?? 200000,
    decorationMgmtRate,
    decorationMgmtRateResidential,
    decorationMgmtRateCommercial,
    garbageTransportRate: partial.garbageTransportRate ?? 250,
    unitPrice,
    unitPriceResidential,
    unitPriceCommercialL1,
    unitPriceCommercialL2,
    propertyType,
  };
}

describe('费用计算引擎（住房口径）', () => {
  const service = new FeeCalculationService(null as never);
  const ctx = makeCtx({ propertyType: PropertyType.RESIDENTIAL });

  it('交房四项：面积 100㎡、欠费 3 个月（住房装修 1.8、物业 1.2）', () => {
    const items = service.calcDeliveryFees(10000, 3, ctx);
    expect(items[0].amount).toBe(200000); // 装修押金 2000 元
    expect(items[1].amount).toBe(18000); // 装修管理费 180 元（100×90×0.02）
    expect(items[2].amount).toBe(25000); // 垃圾清运费 250 元（100×2.5）
    expect(items[3].amount).toBe(36000); // 物业费 360 元（100×1.2×3）
    expect(items[1].calcBasis).toContain('90 × 0.02');
    expect(items[1].calcBasis).toContain('住房');
    for (const item of items) {
      expect(item.calcBasis.length).toBeGreaterThan(0);
      expect(item.parameterSnapshot).toBeDefined();
    }
  });

  it('面积小数边界（33.33㎡）金额精确到分，无浮点误差', () => {
    const areaFen = 3333; // 33.33㎡
    const decoration = service.calcDecorationMgmt(areaFen, ctx);
    const garbage = service.calcGarbageTransport(areaFen, ctx);
    // 3333×180/100 = 5999.4 → 5999 分
    expect(decoration.amount).toBe(5999);
    expect(garbage.amount).toBe(8333); // 3333×250/100 = 8332.5 → 8333 分
    expect(Number.isInteger(decoration.amount)).toBe(true);
    expect(Number.isInteger(garbage.amount)).toBe(true);
  });

  it('物业费 = 面积百分位 × 单价分 ÷ 100 × 月数', () => {
    expect(service.calcPropertyFee(10000, 6, ctx).amount).toBe(72000); // 100×1.2×6 = 720 元
  });

  it('起始日非 1 号时按天折算首月', () => {
    // 月租 12000 分；2022-05-15~31：17/31；再加 6 月整月
    const item = service.calcPropertyFeeByDateRange(10000, '2022-05-15', '2022-06-30', ctx);
    const mayPart = Math.round((12000 * 17) / 31);
    expect(item.amount).toBe(mayPart + 12000);
    expect(item.calcBasis).toContain('按天');
  });

  it('交房物业费传入起始日时走按天精确', () => {
    const items = service.calcDeliveryFees(10000, 2, ctx, '2022-05-15');
    const property = items[3];
    const mayPart = Math.round((12000 * 17) / 31);
    expect(property.amount).toBe(mayPart + 12000);
  });
});

describe('费用计算引擎（门面口径）', () => {
  const service = new FeeCalculationService(null as never);

  it('门面一楼：物业费面积×2，装修管理费面积×0.01×90', () => {
    const ctx = makeCtx({ propertyType: PropertyType.COMMERCIAL_L1 });
    expect(ctx.unitPrice).toBe(200);
    expect(ctx.decorationMgmtRate).toBe(90);

    const property = service.calcPropertyFee(10000, 3, ctx);
    expect(property.amount).toBe(60000); // 100×2×3 = 600 元
    expect(property.calcBasis).toContain('门面一楼');
    expect(property.calcBasis).toContain('面积×2');

    const decoration = service.calcDecorationMgmt(10000, ctx);
    expect(decoration.amount).toBe(9000); // 100×0.9 = 90 元
    expect(decoration.calcBasis).toContain('0.01 × 90');
    expect(decoration.calcBasis).toContain('门面');

    const garbage = service.calcGarbageTransport(10000, ctx);
    expect(garbage.amount).toBe(25000); // 与住房相同 2.5
  });

  it('门面二楼：物业费面积×0.7', () => {
    const ctx = makeCtx({ propertyType: PropertyType.COMMERCIAL_L2 });
    expect(ctx.unitPrice).toBe(70);
    const property = service.calcPropertyFee(10000, 2, ctx);
    expect(property.amount).toBe(14000); // 100×0.7×2 = 140 元
    expect(property.calcBasis).toContain('门面二楼');
    expect(property.calcBasis).toContain('面积×0.7');
  });

  it('旧 COMMERCIAL 归一化为门面一楼单价', async () => {
    const feeParameterService = {
      current: async () => ({
        DEPOSIT_DECORATION_AMOUNT: 200000,
        DECORATION_MGMT_RATE: 180,
        DECORATION_MGMT_RATE_COMMERCIAL: 90,
        GARBAGE_TRANSPORT_RATE: 250,
        PROPERTY_FEE_UNIT_PRICE: 120,
        PROPERTY_FEE_UNIT_PRICE_COMMERCIAL: 200,
        PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2: 70,
      }),
    };
    const svc = new FeeCalculationService(feeParameterService as never);
    const ctx = await svc.resolveParameters(1, 1, PropertyType.COMMERCIAL);
    expect(ctx.propertyType).toBe(PropertyType.COMMERCIAL_L1);
    expect(ctx.unitPrice).toBe(200);
    expect(ctx.decorationMgmtRate).toBe(90);
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
