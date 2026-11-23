import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ChargeType, CommonStatus, DiscountType, FeeItemCode, FeeParameterCode, LedgerStatus, PaymentStatus, ReceiptStatus } from '@pms/shared';

/** 收款单（单据编号全局唯一，快照固化计算依据） */
@Entity('receipt_order')
@Index(['orderNo'], { unique: true })
@Index(['companyId', 'projectId', 'createdAt'])
@Index(['companyId', 'customerId'])
export class ReceiptOrderEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'project_id' })
  projectId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'order_no' })
  orderNo!: string;

  @Column({ name: 'charge_type', type: 'text'})
  chargeType!: ChargeType;

  /** 开单时刻快照：项目名称/房号/姓名/面积/单价/系数等 */
  @Column({ name: 'snapshot_json', type: 'text'})
  snapshotJson!: string;

  @Column({ name: 'discount_type', nullable: true, type: 'text'})
  discountType?: DiscountType;

  @Column({ name: 'discount_amount', default: 0 })
  discountAmount!: number;

  @Column({ name: 'deposit_deduct', default: 0 })
  depositDeduct!: number;

  @Column({ name: 'receivable_amount', default: 0 })
  receivableAmount!: number;

  @Column({ name: 'received_amount', default: 0 })
  receivedAmount!: number;

  /** spec 5.4.1 规则 1 收款单 20 项字段快照 */
  @Column({ name: 'payer_snapshot', type: 'text'})
  payerSnapshot!: string;

  @Column({ name: 'status', default: ReceiptStatus.EFFECTIVE, type: 'text'})
  status!: ReceiptStatus;

  @Column({ name: 'fee_category_ref', nullable: true })
  feeCategoryRef?: number;

  /** 收款人 */
  @Column({ name: 'payee_name' })
  payeeName!: string;

  @Column({ name: 'paid_at', nullable: true })
  paidAt?: string;

  /** 固定备注（逐字一致） */
  @Column({ name: 'remark', type: 'text'})
  remark!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('receipt_order_item')
@Index(['orderId'])
export class ReceiptOrderItemEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'order_id' })
  orderId!: number;

  @Column({ name: 'fee_item_code', type: 'text'})
  feeItemCode!: FeeItemCode;

  /** 其他缴费的费用类别字典引用 */
  @Column({ name: 'fee_category_ref', nullable: true })
  feeCategoryRef?: number;

  @Column({ name: 'calc_basis_snapshot', type: 'text'})
  calcBasisSnapshot!: string;

  /** 参数快照 JSON */
  @Column({ name: 'parameter_snapshot', type: 'text', nullable: true })
  parameterSnapshot?: string;

  @Column({ name: 'amount' })
  amount!: number;
}

/** 物业费月段台账：已缴费月数/剩余应交费月份/重复缴费拦截的唯一事实来源 */
@Entity('property_fee_ledger')
@Index(['customerId', 'startMonth', 'endMonth'])
@Index(['companyId', 'customerId', 'status'])
export class PropertyFeeLedgerEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'receipt_order_id' })
  receiptOrderId!: number;

  /** YYYY-MM */
  @Column({ name: 'start_month' })
  startMonth!: string;

  @Column({ name: 'end_month' })
  endMonth!: string;

  @Column({ name: 'months' })
  months!: number;

  /** 单价快照（分/㎡/月） */
  @Column({ name: 'unit_price_snapshot' })
  unitPriceSnapshot!: number;

  /** 面积快照（0.01㎡） */
  @Column({ name: 'area_snapshot' })
  areaSnapshot!: number;

  @Column({ name: 'status', default: LedgerStatus.EFFECTIVE, type: 'text'})
  status!: LedgerStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 收款记录/支付流水（幂等键 UNIQUE(order, channel, trade_no)） */
@Entity('payment_record')
@Index(['receiptOrderId', 'channelType', 'channelTradeNo'], { unique: true })
@Index(['companyId', 'status'])
export class PaymentRecordEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'receipt_order_id' })
  receiptOrderId!: number;

  @Column({ name: 'method_code' })
  methodCode!: string;

  @Column({ name: 'channel_type' })
  channelType!: string;

  @Column({ name: 'channel_trade_no', nullable: true })
  channelTradeNo?: string;

  @Column({ name: 'amount' })
  amount!: number;

  @Column({ name: 'status', default: PaymentStatus.SUCCESS, type: 'text'})
  status!: PaymentStatus;

  @Column({ name: 'operator_id', nullable: true })
  operatorId?: number;

  @Column({ name: 'paid_at' })
  paidAt!: string;

  @Column({ name: 'raw_callback', type: 'text', nullable: true })
  rawCallback?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 费用参数（版本化：项目级覆盖公司级） */
@Entity('fee_parameter')
@Index(['companyId', 'projectId', 'itemCode', 'effectiveAt'])
export class FeeParameterEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'project_id', nullable: true })
  projectId?: number;

  @Column({ name: 'item_code', type: 'text'})
  itemCode!: FeeParameterCode;

  /** 参数值（整数分口径存储：金额分/百分位单位） */
  @Column({ name: 'value' })
  value!: number;

  @Column({ name: 'effective_at' })
  effectiveAt!: string;

  @Column({ name: 'operator_id', nullable: true })
  operatorId?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 费用类别字典（其他缴费筛选项，可扩展零代码变更） */
@Entity('fee_category')
@Index(['companyId', 'code'], { unique: true })
export class FeeCategoryEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'code' })
  code!: string;

  @Column({ name: 'name' })
  name!: string;

  @Column({ name: 'enabled', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 收款方式字典 */
@Entity('payment_method')
@Index(['companyId', 'code'], { unique: true })
export class PaymentMethodEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'code' })
  code!: string;

  @Column({ name: 'name' })
  name!: string;

  @Column({ name: 'enabled', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 单据编号日序列发号器 */
@Entity('sequence_daily')
@Index(['companyPrefix', 'seqDate'], { unique: true })
export class SequenceDailyEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'company_prefix' })
  companyPrefix!: string;

  @Column({ name: 'seq_date' })
  seqDate!: string;

  @Column({ name: 'last_no', default: 0 })
  lastNo!: number;
}

/** 业主端验证失败计数（防爆破锁定 30 分钟） */
@Entity('owner_verify_attempt')
@Index(['roomNo', 'projectId', 'attemptDate'])
export class OwnerVerifyAttemptEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'project_id' })
  projectId!: number;

  @Column({ name: 'room_no' })
  roomNo!: string;

  @Column({ name: 'fail_count', default: 0 })
  failCount!: number;

  @Column({ name: 'locked_until', nullable: true })
  lockedUntil?: string;

  @Column({ name: 'attempt_date' })
  attemptDate!: string;

  @Column({ name: 'status', default: CommonStatus.ACTIVE })
  status!: string;
}
export const chargingEntities = [
  ReceiptOrderEntity,
  ReceiptOrderItemEntity,
  PropertyFeeLedgerEntity,
  PaymentRecordEntity,
  FeeParameterEntity,
  FeeCategoryEntity,
  PaymentMethodEntity,
  SequenceDailyEntity,
  OwnerVerifyAttemptEntity,
];
