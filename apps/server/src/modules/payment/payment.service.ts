import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ChannelType, ErrorCodes, LedgerStatus, NotificationType, PaymentStatus, ReceiptStatus } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TenantService } from '../../common/tenant/tenant.service';
import { NotificationService } from '../notification/notification.service';
import {
  PaymentRecordEntity,
  PropertyFeeLedgerEntity,
  ReceiptOrderEntity,
} from '../../database/entities/charging-entities';

/**
 * 支付渠道适配器契约（二期扩展点）：
 * 实现新 Provider 并注册到渠道注册表 → 回调接口自动路由 →
 * 验签成功后复用 confirm 核销事务，缴费主流程与数据模型零改动。
 */
export interface PaymentChannelProvider {
  readonly channelType: ChannelType;
  createPayment(orderNo: string, amount: number, returnUrl?: string): Promise<{ payUrl?: string; tradeNo?: string }>;
  handleCallback(rawBody: unknown): Promise<{ orderNo: string; tradeNo: string; success: boolean }>;
  verifyCompletion(orderNo: string): Promise<boolean>;
}

/** 一期离线登记 Provider：管理端当面缴费登记 success；业主端登记 pending */
@Injectable()
export class OfflineRecordProvider implements PaymentChannelProvider {
  readonly channelType = ChannelType.OFFLINE_RECORD;

  async createPayment(): Promise<{ payUrl?: string; tradeNo?: string }> {
    // 离线登记无支付 URL
    return {};
  }

  async handleCallback(): Promise<{ orderNo: string; tradeNo: string; success: boolean }> {
    throw new BusinessException(ErrorCodes.NOT_IMPLEMENTED_PHASE2, '离线登记渠道无异步回调');
  }

  async verifyCompletion(): Promise<boolean> {
    return true;
  }
}

/** 渠道注册表：二期新增 Provider 零改动接入 */
@Injectable()
export class PaymentChannelRegistry {
  private readonly providers = new Map<ChannelType, PaymentChannelProvider>();

  constructor(private readonly offlineProvider: OfflineRecordProvider) {
    this.register(this.offlineProvider);
    // 预留渠道注册点（二期）：wechat_pay / alipay
  }

  register(provider: PaymentChannelProvider): void {
    this.providers.set(provider.channelType, provider);
  }

  get(channelType: ChannelType): PaymentChannelProvider | undefined {
    return this.providers.get(channelType);
  }
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: PaymentChannelRegistry,
    @InjectRepository(ReceiptOrderEntity) private readonly receiptRepo: Repository<ReceiptOrderEntity>,
    @InjectRepository(PaymentRecordEntity) private readonly paymentRepo: Repository<PaymentRecordEntity>,
    @InjectRepository(PropertyFeeLedgerEntity) private readonly ledgerRepo: Repository<PropertyFeeLedgerEntity>,
    private readonly tenantService: TenantService,
    private readonly notificationService: NotificationService,
  ) {}

  /** 收款记录列表（pending 待确认筛选） */
  async listRecords(companyId: number, status?: ReceiptStatus | PaymentStatus, page = 1, pageSize = 20) {
    const qb = this.paymentRepo
      .createQueryBuilder('p')
      .leftJoin(ReceiptOrderEntity, 'r', 'r.id = p.receiptOrderId')
      .where('p.companyId = :companyId', { companyId })
      .orderBy('p.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (status) qb.andWhere('p.status = :status', { status });
    const [records, total] = await qb.getManyAndCount();
    const orderIds = records.map((r) => r.receiptOrderId);
    const orders = orderIds.length > 0
      ? await this.receiptRepo.find({ where: { id: In(orderIds) } })
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    return {
      list: records.map((p) => {
        const order = orderMap.get(p.receiptOrderId);
        return {
          id: p.id,
          receiptOrderId: p.receiptOrderId,
          orderNo: order?.orderNo,
          amount: p.amount,
          methodCode: p.methodCode,
          channelType: p.channelType,
          channelTradeNo: p.channelTradeNo,
          status: p.status,
          paidAt: p.paidAt,
          receiptStatus: order?.status,
          customerName: order ? (JSON.parse(order.payerSnapshot || '{}').customerName ?? '') : '',
          roomNo: order ? (JSON.parse(order.snapshotJson || '{}').roomNo ?? '') : '',
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 确认到账（单事务）：收款单 pending→effective、预占月段转 effective 完成核销、生成电子收据、触发通知 */
  async confirm(recordId: number): Promise<{ orderNo: string }> {
    const companyId = this.tenantService.requireCompanyId();
    const userId = this.tenantService.requireUserId();
    return this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(PaymentRecordEntity, { where: { id: recordId, companyId } });
      if (!record) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款记录不存在');
      if (record.status !== PaymentStatus.PENDING) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '该记录不是待确认状态');
      }
      const order = await manager.findOne(ReceiptOrderEntity, {
        where: { id: record.receiptOrderId, companyId, status: ReceiptStatus.PENDING },
      });
      if (!order) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款单不是待确认状态');

      const now = new Date().toISOString();
      record.status = PaymentStatus.SUCCESS;
      record.operatorId = userId;
      record.paidAt = now;
      await manager.save(record);

      order.status = ReceiptStatus.EFFECTIVE;
      order.paidAt = now;
      await manager.save(order);

      // 预占月段转 effective 完成核销
      await manager
        .createQueryBuilder()
        .update(PropertyFeeLedgerEntity)
        .set({ status: LedgerStatus.EFFECTIVE })
        .where('receiptOrderId = :orderId AND status = :pending', { orderId: order.id, pending: LedgerStatus.PENDING })
        .execute();

      // 电子收据即收款单本体（同编号同金额），触发缴费结果通知
      const snapshot = JSON.parse(order.payerSnapshot || '{}');
      await this.notificationService.push(
        manager,
        companyId,
        order.customerId,
        NotificationType.PAYMENT_RESULT,
        '缴费确认到账',
        `您的缴费单 ${order.orderNo}（${(order.receivedAmount / 100).toFixed(2)} 元）已确认到账，电子收据可查。`,
        order.orderNo,
      );
      void snapshot;
      return { orderNo: order.orderNo };
    });
  }

  /** 驳回（单事务）：单据转 void 冲销、月段释放、通知业主 */
  async reject(recordId: number, reason: string): Promise<void> {
    const companyId = this.tenantService.requireCompanyId();
    const userId = this.tenantService.requireUserId();
    await this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(PaymentRecordEntity, { where: { id: recordId, companyId } });
      if (!record) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款记录不存在');
      const order = await manager.findOne(ReceiptOrderEntity, { where: { id: record.receiptOrderId, companyId } });
      if (!order) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款单不存在');
      if (order.status !== ReceiptStatus.PENDING) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '仅待确认单据可驳回');
      }

      record.status = PaymentStatus.FAILED;
      record.operatorId = userId;
      await manager.save(record);

      order.status = ReceiptStatus.VOID;
      await manager.save(order);

      // 月段释放（pending → void）
      await manager
        .createQueryBuilder()
        .update(PropertyFeeLedgerEntity)
        .set({ status: LedgerStatus.VOID })
        .where('receiptOrderId = :orderId AND status = :pending', { orderId: order.id, pending: LedgerStatus.PENDING })
        .execute();

      await this.notificationService.push(
        manager,
        companyId,
        order.customerId,
        NotificationType.PAYMENT_RESULT,
        '缴费登记被驳回',
        `您的缴费登记 ${order.orderNo} 未通过确认${reason ? `：${reason}` : ''}，月段已释放，可重新发起缴费。`,
        order.orderNo,
      );
    });
  }

  /** 支付渠道回调（一期统一返回"渠道未启用"占位；二期注册 Provider 后自动路由） */
  async handleCallback(channelType: string, rawBody: unknown) {
    const provider = this.registry.get(channelType as ChannelType);
    if (!provider) {
      throw new BusinessException(ErrorCodes.NOT_IMPLEMENTED_PHASE2, '渠道未启用');
    }
    return provider.handleCallback(rawBody);
  }
}