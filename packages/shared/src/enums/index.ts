/** 住户身份类型：业主 / 租户（自然人优先以手机号识别，身份证可选） */
export enum ResidentType {
  OWNER = 'OWNER',
  TENANT = 'TENANT',
}

export const RESIDENT_TYPE_LABELS: Record<ResidentType, string> = {
  [ResidentType.OWNER]: '业主',
  [ResidentType.TENANT]: '租户',
};

/** 房屋性质：住房 / 门面一楼 / 门面二楼（计费口径不同） */
export enum PropertyType {
  RESIDENTIAL = 'RESIDENTIAL',
  /** @deprecated 兼容旧数据，等同门面一楼 */
  COMMERCIAL = 'COMMERCIAL',
  COMMERCIAL_L1 = 'COMMERCIAL_L1',
  COMMERCIAL_L2 = 'COMMERCIAL_L2',
}

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  [PropertyType.RESIDENTIAL]: '住房',
  [PropertyType.COMMERCIAL]: '门面一楼',
  [PropertyType.COMMERCIAL_L1]: '门面一楼',
  [PropertyType.COMMERCIAL_L2]: '门面二楼',
};

/** 是否门面（含旧 COMMERCIAL） */
export function isCommercialProperty(type: PropertyType | string | undefined | null): boolean {
  return (
    type === PropertyType.COMMERCIAL ||
    type === PropertyType.COMMERCIAL_L1 ||
    type === PropertyType.COMMERCIAL_L2
  );
}

/** 归一化房屋性质（旧 COMMERCIAL → 一楼） */
export function normalizePropertyType(type: PropertyType | string | undefined | null): PropertyType {
  if (type === PropertyType.COMMERCIAL_L2) return PropertyType.COMMERCIAL_L2;
  if (type === PropertyType.COMMERCIAL || type === PropertyType.COMMERCIAL_L1) {
    return PropertyType.COMMERCIAL_L1;
  }
  return PropertyType.RESIDENTIAL;
}

/** 房屋状态 */
export enum HouseStatus {
  UNDELIVERED = 'UNDELIVERED',
  DELIVERED = 'DELIVERED',
  DECORATING = 'DECORATING',
  OCCUPIED = 'OCCUPIED',
  VACANT = 'VACANT',
}

export const HOUSE_STATUS_LABELS: Record<HouseStatus, string> = {
  [HouseStatus.UNDELIVERED]: '未交房',
  [HouseStatus.DELIVERED]: '已交房',
  [HouseStatus.DECORATING]: '装修中',
  [HouseStatus.OCCUPIED]: '已入住',
  [HouseStatus.VACANT]: '空置',
};

/** 缴费类型 */
export enum ChargeType {
  DELIVERY = 'DELIVERY',
  PROPERTY = 'PROPERTY',
  OTHER = 'OTHER',
}

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  [ChargeType.DELIVERY]: '交房缴费',
  [ChargeType.PROPERTY]: '物业费续费',
  [ChargeType.OTHER]: '其他缴费',
};

/** 费用项（交房缴费四项） */
export enum FeeItemCode {
  DEPOSIT_DECORATION = 'DEPOSIT_DECORATION',
  DECORATION_MGMT = 'DECORATION_MGMT',
  GARBAGE_TRANSPORT = 'GARBAGE_TRANSPORT',
  PROPERTY_FEE = 'PROPERTY_FEE',
}

export const FEE_ITEM_LABELS: Record<FeeItemCode, string> = {
  [FeeItemCode.DEPOSIT_DECORATION]: '装修押金',
  [FeeItemCode.DECORATION_MGMT]: '装修管理费',
  [FeeItemCode.GARBAGE_TRANSPORT]: '垃圾清运费',
  [FeeItemCode.PROPERTY_FEE]: '物业费',
};

/** 费用参数项编码（费用参数配置表 item_code） */
export enum FeeParameterCode {
  DEPOSIT_DECORATION_AMOUNT = 'DEPOSIT_DECORATION_AMOUNT',
  /** 住房装修管理费：面积×90×0.02 = 1.8 元/㎡ */
  DECORATION_MGMT_RATE = 'DECORATION_MGMT_RATE',
  /** 门面装修管理费：面积×0.01×90 = 0.9 元/㎡ */
  DECORATION_MGMT_RATE_COMMERCIAL = 'DECORATION_MGMT_RATE_COMMERCIAL',
  GARBAGE_TRANSPORT_RATE = 'GARBAGE_TRANSPORT_RATE',
  /** 住房物业费单价（分/㎡/月） */
  PROPERTY_FEE_UNIT_PRICE = 'PROPERTY_FEE_UNIT_PRICE',
  /** 门面一楼物业费单价（分/㎡/月），默认 2.00 元 */
  PROPERTY_FEE_UNIT_PRICE_COMMERCIAL = 'PROPERTY_FEE_UNIT_PRICE_COMMERCIAL',
  /** 门面二楼物业费单价（分/㎡/月），默认 0.70 元 */
  PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2 = 'PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2',
}

export const FEE_PARAMETER_LABELS: Record<FeeParameterCode, string> = {
  [FeeParameterCode.DEPOSIT_DECORATION_AMOUNT]: '装修押金（元）',
  [FeeParameterCode.DECORATION_MGMT_RATE]: '住房装修管理费（元/㎡）= 面积×90×0.02',
  [FeeParameterCode.DECORATION_MGMT_RATE_COMMERCIAL]: '门面装修管理费（元/㎡）= 面积×0.01×90',
  [FeeParameterCode.GARBAGE_TRANSPORT_RATE]: '垃圾清运费（元/㎡）= 面积×2.5',
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE]: '住房物业费单价（元/㎡/月）',
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL]: '门面一楼物业费单价（元/㎡/月）= 面积×2',
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2]: '门面二楼物业费单价（元/㎡/月）= 面积×0.7',
};

/** 优惠类型 */
export enum DiscountType {
  FULL = 'FULL',
  VACANT = 'VACANT',
  OTHER = 'OTHER',
}

export const DISCOUNT_TYPE_LABELS: Record<DiscountType, string> = {
  [DiscountType.FULL]: '全额优惠',
  [DiscountType.VACANT]: '空置房优惠',
  [DiscountType.OTHER]: '其他优惠',
};

/** 收款单状态 */
export enum ReceiptStatus {
  PENDING = 'pending',
  EFFECTIVE = 'effective',
  VOID = 'void',
}

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  [ReceiptStatus.PENDING]: '待确认',
  [ReceiptStatus.EFFECTIVE]: '已生效',
  [ReceiptStatus.VOID]: '已作废',
};

/** 物业费月段台账状态 */
export enum LedgerStatus {
  PENDING = 'pending',
  EFFECTIVE = 'effective',
  VOID = 'void',
}

export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
  [LedgerStatus.PENDING]: '预占中',
  [LedgerStatus.EFFECTIVE]: '已生效',
  [LedgerStatus.VOID]: '已释放',
};

/** 支付记录状态 */
export enum PaymentStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.PENDING]: '待确认',
  [PaymentStatus.SUCCESS]: '已确认',
  [PaymentStatus.FAILED]: '已驳回',
};

/** 支付渠道类型 */
export enum ChannelType {
  OFFLINE_RECORD = 'offline_record',
  WECHAT_PAY = 'wechat_pay',
  ALIPAY = 'alipay',
}

/** 通知类型 */
export enum NotificationType {
  ARREARS_REMIND = 'ARREARS_REMIND',
  PAYMENT_RESULT = 'PAYMENT_RESULT',
  WORK_ORDER_STATUS = 'WORK_ORDER_STATUS',
}

/** 通知 outbox 状态 */
export enum NotificationOutboxStatus {
  OUTBOX = 'outbox',
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

/** 工单状态（二期契约） */
export enum WorkOrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CLOSED = 'CLOSED',
}

/** 用户/项目状态 */
export enum CommonStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

export const COMMON_STATUS_LABELS: Record<CommonStatus, string> = {
  [CommonStatus.ACTIVE]: '启用',
  [CommonStatus.DISABLED]: '停用',
};

/** 权限点类型 */
export enum PermissionType {
  OPERATION = 'operation',
  QUERY_SCOPE = 'query_scope',
}

/** 权限覆盖类型 */
export enum PermissionOverrideType {
  ALLOW = 'allow',
  DENY = 'deny',
}