import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ChargeType,
  DiscountType,
  ErrorCodes,
  FeeItemCode,
  HOUSE_STATUS_LABELS,
  HouseStatus,
  isVacantDiscountEligible,
  LedgerStatus,
  normalizeHouseStatus,
  PaymentStatus,
  ReceiptStatus,
  RECEIPT_DELIVERY_PROPERTY_REMARK,
  RECEIPT_FIXED_REMARK,
} from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TenantService } from '../../common/tenant/tenant.service';
import { CustomerEntity, ProjectEntity } from '../../database/entities/org-entities';
import { UserEntity } from '../../database/entities/auth-entities';
import {
  FeeCategoryEntity,
  PaymentMethodEntity,
  PaymentRecordEntity,
  PropertyFeeLedgerEntity,
  ReceiptOrderEntity,
  ReceiptOrderItemEntity,
} from '../../database/entities/charging-entities';
import { FeeCalculationService, FeeCalcResult } from '../fee-calculation/fee-calculation.service';
import { CustomerService } from '../customer/customer.service';
import { SequenceService } from './sequence.service';

export interface ChargeResult {
  orderNo: string;
  receivableAmount: number;
  discountAmount: number;
  depositDeduct: number;
  receivedAmount: number;
  items: FeeCalcResult[];
  remark: string;
  billingInfo?: Record<string, unknown>;
}

@Injectable()
export class ChargingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ReceiptOrderEntity) private readonly receiptRepo: Repository<ReceiptOrderEntity>,
    @InjectRepository(ReceiptOrderItemEntity) private readonly itemRepo: Repository<ReceiptOrderItemEntity>,
    @InjectRepository(PropertyFeeLedgerEntity) private readonly ledgerRepo: Repository<PropertyFeeLedgerEntity>,
    @InjectRepository(PaymentRecordEntity) private readonly paymentRepo: Repository<PaymentRecordEntity>,
    @InjectRepository(CustomerEntity) private readonly customerRepo: Repository<CustomerEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(PaymentMethodEntity) private readonly methodRepo: Repository<PaymentMethodEntity>,
    @InjectRepository(FeeCategoryEntity) private readonly categoryRepo: Repository<FeeCategoryEntity>,
    private readonly feeCalculationService: FeeCalculationService,
    private readonly sequenceService: SequenceService,
    private readonly tenantService: TenantService,
    private readonly customerService: CustomerService,
  ) {}

  /** 空置房优惠：未交房/未装修可享；已装修不可 */
  private assertVacantDiscountAllowed(customer: CustomerEntity, discountType?: DiscountType) {
    if (discountType !== DiscountType.VACANT) return;
    if (!isVacantDiscountEligible(customer.houseStatus)) {
      throw new BusinessException(
        ErrorCodes.VALIDATION_FAILED,
        '空置房优惠仅适用于未装修房屋；装修报备后房屋为已装修，不可再享空置优惠',
      );
    }
  }

  /** 未装修报备不可押金抵扣 */
  private async assertDepositDeductAllowed(companyId: number, customerId: number, depositDeduct?: number) {
    if (!depositDeduct || depositDeduct <= 0) return;
    const ok = await this.customerService.hasActiveDecorateFiling(companyId, customerId);
    if (!ok) {
      throw new BusinessException(
        ErrorCodes.VALIDATION_FAILED,
        '未进行装修报备不可押金抵扣；请先在客户档案中登记装修报备',
      );
    }
  }

  /* ============ 6.2 交房缴费（单事务） ============ */
  async chargeDelivery(input: {
    projectId: number;
    roomNo: string;
    discountType?: DiscountType;
    discountAmount?: number;
    depositDeduct?: number;
    paymentMethodCode: string;
  }): Promise<ChargeResult> {
    const companyId = this.tenantService.requireCompanyId();
    const userId = this.tenantService.requireUserId();
    const prefix = process.env.RECEIPT_NO_PREFIX ?? 'PM';
    const seqDate = new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      // ① 客户与项目（事务内复查）
      const customer = await manager.findOne(CustomerEntity, {
        where: { companyId, projectId: input.projectId, roomNo: input.roomNo },
      });
      if (!customer || customer.deletedAt) throw new BusinessException(ErrorCodes.ROOM_NO_NOT_FOUND);
      const project = await manager.findOne(ProjectEntity, { where: { id: input.projectId, companyId } });
      if (!project) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目不存在');
      this.assertVacantDiscountAllowed(customer, input.discountType);
      await this.assertDepositDeductAllowed(companyId, customer.id, input.depositDeduct);

      // ①a 复查押金/装修管理费/垃圾清运费未缴（重复拦截）
      const existingDelivery = await manager.findOne(ReceiptOrderEntity, {
        where: { companyId, customerId: customer.id, chargeType: ChargeType.DELIVERY, status: ReceiptStatus.EFFECTIVE },
      });
      if (existingDelivery || normalizeHouseStatus(customer.houseStatus) !== HouseStatus.UNDELIVERED) {
        throw new BusinessException(ErrorCodes.FEE_ALREADY_PAID, '该费用已缴纳');
      }

      // ② 计算四项费用（物业费按起始日精确到天）
      const ledgers = await manager.find(PropertyFeeLedgerEntity, { where: { companyId, customerId: customer.id } });
      const ctx = await this.feeCalculationService.resolveParameters(
        companyId,
        input.projectId,
        customer.propertyType,
      );
      const arrearsMonths = this.feeCalculationService.arrearsMonthsFor(customer, ledgers);
      const items = this.feeCalculationService.calcDeliveryFees(
        customer.houseArea,
        arrearsMonths,
        ctx,
        customer.feeStartDate,
      );
      const receivable = items.reduce((s, i) => s + i.amount, 0);

      // ②a 校验优惠 + 押金抵扣 ≤ 应交；实收 ≥ 0
      const discountAmount = input.discountAmount ?? 0;
      const depositDeduct = input.depositDeduct ?? 0;
      if (input.discountType && discountAmount > receivable) {
        throw new BusinessException(ErrorCodes.DISCOUNT_EXCEED_RECEIVABLE);
      }
      if (depositDeduct > receivable - discountAmount) {
        throw new BusinessException(ErrorCodes.DEDUCT_EXCEED_LIMIT, '抵扣金额超出可抵扣上限');
      }
      const received = receivable - discountAmount - depositDeduct;
      if (received < 0) {
        throw new BusinessException(ErrorCodes.RECEIVED_NEGATIVE);
      }

      // ③ 发号 + ④ 收款单（effective）+ 明细行（四项逐条 + 快照）
      const orderNo = await this.sequenceService.nextOrderNo(manager, companyId, prefix, seqDate);
      const now = new Date().toISOString();
      const receipt = await manager.save(
        manager.create(ReceiptOrderEntity, {
          companyId,
          projectId: input.projectId,
          customerId: customer.id,
          orderNo,
          chargeType: ChargeType.DELIVERY,
          snapshotJson: JSON.stringify({
            projectName: project.name,
            roomNo: customer.roomNo,
            customerName: customer.name,
            houseAreaFen: customer.houseArea,
            houseStatus: customer.houseStatus,
            arrearsMonths,
          }),
          discountType: input.discountType,
          discountAmount,
          depositDeduct,
          receivableAmount: receivable,
          receivedAmount: received,
          payerSnapshot: JSON.stringify({
            projectName: project.name,
            customerName: customer.name,
            roomNo: customer.roomNo,
            houseStatusLabel: HOUSE_STATUS_LABELS[customer.houseStatus as keyof typeof HOUSE_STATUS_LABELS],
            items,
          }),
          status: ReceiptStatus.EFFECTIVE,
          payeeName: (await manager.findOne(UserEntity, { where: { id: userId } }))?.realName ?? '收费员',
          paidAt: now,
          remark: RECEIPT_DELIVERY_PROPERTY_REMARK,
        }),
      );
      await manager.save(
        items.map((item) =>
          manager.create(ReceiptOrderItemEntity, {
            companyId,
            orderId: (receipt as ReceiptOrderEntity).id,
            feeItemCode: item.feeItemCode,
            calcBasisSnapshot: item.calcBasis,
            parameterSnapshot: JSON.stringify(item.parameterSnapshot),
            amount: item.amount,
          }),
        ),
      );

      // ⑤ 物业费月段台账（effective：起始月起 arrearsMonths 个月）
      const startMonth = FeeCalculationService.monthOf(customer.feeStartDate);
      if (arrearsMonths > 0) {
        await manager.save(
          manager.create(PropertyFeeLedgerEntity, {
            companyId,
            customerId: customer.id,
            receiptOrderId: (receipt as ReceiptOrderEntity).id,
            startMonth,
            endMonth: FeeCalculationService.addMonths(startMonth, arrearsMonths - 1),
            months: arrearsMonths,
            unitPriceSnapshot: ctx.unitPrice,
            areaSnapshot: customer.houseArea,
            status: LedgerStatus.EFFECTIVE,
          }),
        );
      }

      // ⑥ 支付记录（offline_record，success）
      await manager.save(
        manager.create(PaymentRecordEntity, {
          companyId,
          receiptOrderId: (receipt as ReceiptOrderEntity).id,
          methodCode: input.paymentMethodCode,
          channelType: 'offline_record',
          amount: received,
          status: PaymentStatus.SUCCESS,
          operatorId: userId,
          paidAt: now,
        }),
      );

      // ⑦ 交房完成：未交房 → 未装修
      customer.deliveryDate = now;
      customer.houseStatus = HouseStatus.UNDECORATED;
      await manager.save(customer);

      return {
        orderNo,
        receivableAmount: receivable,
        discountAmount,
        depositDeduct,
        receivedAmount: received,
        items,
        remark: RECEIPT_DELIVERY_PROPERTY_REMARK,
      };
      // ⑧ 审计日志由 @Audit 拦截器在成功后写入
    });
  }

  /* ============ 6.3 物业费续费（单事务 + 月段台账） ============ */
  async chargeProperty(input: {
    projectId: number;
    roomNo: string;
    months: number;
    startMonth: string;
    discountType?: DiscountType;
    discountAmount?: number;
    depositDeduct?: number;
    paymentMethodCode: string;
  }): Promise<ChargeResult> {
    const companyId = this.tenantService.requireCompanyId();
    const userId = this.tenantService.requireUserId();
    const prefix = process.env.RECEIPT_NO_PREFIX ?? 'PM';
    const seqDate = new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const customer = await manager.findOne(CustomerEntity, {
        where: { companyId, projectId: input.projectId, roomNo: input.roomNo },
      });
      if (!customer || customer.deletedAt) throw new BusinessException(ErrorCodes.ROOM_NO_NOT_FOUND);
      const project = await manager.findOne(ProjectEntity, { where: { id: input.projectId, companyId } });
      if (!project) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目不存在');
      this.assertVacantDiscountAllowed(customer, input.discountType);
      await this.assertDepositDeductAllowed(companyId, customer.id, input.depositDeduct);

      // 事务内复查剩余应交费月份 > 0
      const ledgers = await manager.find(PropertyFeeLedgerEntity, { where: { companyId, customerId: customer.id } });
      const ctx = await this.feeCalculationService.resolveParameters(
        companyId,
        input.projectId,
        customer.propertyType,
      );
      const totalBillableMonths = this.feeCalculationService.totalBillableMonths(customer.feeStartDate);
      const paidMonths = this.feeCalculationService.paidMonths(ledgers);
      const remainingMonths = Math.max(0, totalBillableMonths - paidMonths);
      if (remainingMonths === 0) {
        throw new BusinessException(ErrorCodes.PROPERTY_FEE_PAID_OFF, '该客户物业费已缴清');
      }
      // 续费月数为正整数且不超剩余范围
      if (!Number.isInteger(input.months) || input.months <= 0 || input.months > remainingMonths) {
        throw new BusinessException(ErrorCodes.CHARGE_MONTHS_INVALID);
      }
      // 新月段与既有 pending+effective 月段无重叠
      if (FeeCalculationService.hasOverlap(input.startMonth, input.months, ledgers)) {
        throw new BusinessException(ErrorCodes.FEE_ALREADY_PAID, '所选月段与已缴/预占月段重叠');
      }

      const endMonth = FeeCalculationService.addMonths(input.startMonth, input.months - 1);
      const calcItem = this.feeCalculationService.calcPropertyFeeMonthsWithProration(
        customer.houseArea,
        input.startMonth,
        input.months,
        customer.feeStartDate,
        ctx,
      );
      const receivable = calcItem.amount;
      const discountAmount = input.discountAmount ?? 0;
      const depositDeduct = input.depositDeduct ?? 0;
      if (input.discountType && discountAmount > receivable) {
        throw new BusinessException(ErrorCodes.DISCOUNT_EXCEED_RECEIVABLE);
      }
      if (depositDeduct > receivable - discountAmount) {
        throw new BusinessException(ErrorCodes.DEDUCT_EXCEED_LIMIT);
      }
      const received = receivable - discountAmount - depositDeduct;
      if (received < 0) {
        throw new BusinessException(ErrorCodes.RECEIVED_NEGATIVE);
      }

      const orderNo = await this.sequenceService.nextOrderNo(manager, companyId, prefix, seqDate);
      const now = new Date().toISOString();
      const receipt = await manager.save(
        manager.create(ReceiptOrderEntity, {
          companyId,
          projectId: input.projectId,
          customerId: customer.id,
          orderNo,
          chargeType: ChargeType.PROPERTY,
          snapshotJson: JSON.stringify({
            projectName: project.name,
            roomNo: customer.roomNo,
            customerName: customer.name,
            houseAreaFen: customer.houseArea,
          }),
          discountType: input.discountType,
          discountAmount,
          depositDeduct,
          receivableAmount: receivable,
          receivedAmount: received,
          // payer_snapshot：spec 5.4.1 规则 1 收款单全部字段快照
          payerSnapshot: JSON.stringify({
            projectName: project.name,
            customerName: customer.name,
            roomNo: customer.roomNo,
            houseStatusLabel: HOUSE_STATUS_LABELS[customer.houseStatus as keyof typeof HOUSE_STATUS_LABELS],
            orderNo,
            feeStartMonth: input.startMonth,
            feeEndMonth: endMonth,
            totalBillableMonths,
            paidMonths,
            remainingMonthsAfter: remainingMonths - input.months,
            houseAreaFen: customer.houseArea,
            unitPriceFen: ctx.unitPrice,
            receivableAmount: receivable,
            discountType: input.discountType,
            discountAmount,
            depositDeduct,
            receivedAmount: received,
            paymentMethodCode: input.paymentMethodCode,
            payee: (await manager.findOne(UserEntity, { where: { id: userId } }))?.realName ?? '收费员',
            paidAt: now,
          }),
          status: ReceiptStatus.EFFECTIVE,
          payeeName: (await manager.findOne(UserEntity, { where: { id: userId } }))?.realName ?? '收费员',
          paidAt: now,
          remark: RECEIPT_DELIVERY_PROPERTY_REMARK,
        }),
      );
      const orderId = (receipt as ReceiptOrderEntity).id;
      await manager.save(
        manager.create(ReceiptOrderItemEntity, {
          companyId,
          orderId,
          feeItemCode: FeeItemCode.PROPERTY_FEE,
          calcBasisSnapshot: calcItem.calcBasis,
          parameterSnapshot: JSON.stringify(calcItem.parameterSnapshot),
          amount: receivable,
        }),
      );

      // 月段台账（effective）
      await manager.save(
        manager.create(PropertyFeeLedgerEntity, {
          companyId,
          customerId: customer.id,
          receiptOrderId: orderId,
          startMonth: input.startMonth,
          endMonth,
          months: input.months,
          unitPriceSnapshot: ctx.unitPrice,
          areaSnapshot: customer.houseArea,
          status: LedgerStatus.EFFECTIVE,
        }),
      );

      // 支付记录 + 审计（拦截器）
      await manager.save(
        manager.create(PaymentRecordEntity, {
          companyId,
          receiptOrderId: orderId,
          methodCode: input.paymentMethodCode,
          channelType: 'offline_record',
          amount: received,
          status: PaymentStatus.SUCCESS,
          operatorId: userId,
          paidAt: now,
        }),
      );

      return {
        orderNo,
        receivableAmount: receivable,
        discountAmount,
        depositDeduct,
        receivedAmount: received,
        items: [calcItem],
        remark: RECEIPT_DELIVERY_PROPERTY_REMARK,
        billingInfo: {
          feeStartMonth: input.startMonth,
          feeEndMonth: endMonth,
          months: input.months,
          totalBillableMonths,
          paidMonths: paidMonths + input.months,
          remainingMonths: remainingMonths - input.months,
          houseAreaSnapshot: customer.houseArea,
          unitPriceSnapshot: ctx.unitPrice,
        },
      };
    });
  }

  /* ============ 6.4 其他缴费 ============ */
  async chargeOther(input: {
    projectId: number;
    roomNo: string;
    feeCategoryCode: string;
    amount: number;
    discountAmount?: number;
    paymentMethodCode: string;
  }): Promise<ChargeResult> {
    const companyId = this.tenantService.requireCompanyId();
    const userId = this.tenantService.requireUserId();
    const prefix = process.env.RECEIPT_NO_PREFIX ?? 'PM';
    const seqDate = new Date().toISOString().slice(0, 10);

    return this.dataSource.transaction(async (manager) => {
      const customer = await manager.findOne(CustomerEntity, {
        where: { companyId, projectId: input.projectId, roomNo: input.roomNo },
      });
      if (!customer || customer.deletedAt) throw new BusinessException(ErrorCodes.ROOM_NO_NOT_FOUND);
      const project = await manager.findOne(ProjectEntity, { where: { id: input.projectId, companyId } });
      if (!project) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目不存在');

      // 费用类别必选（缺失拒绝）
      if (!input.feeCategoryCode) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '请选择费用类别');
      }
      const category = await manager.findOne(FeeCategoryEntity, {
        where: { companyId, code: input.feeCategoryCode, enabled: true },
      });
      if (!category) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '费用类别不存在或已停用');
      }
      // 费用金额 > 0；优惠 ≤ 费用金额
      if (!Number.isInteger(input.amount) || input.amount <= 0) {
        throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '费用金额必须大于 0');
      }
      const discountAmount = input.discountAmount ?? 0;
      if (discountAmount > input.amount) {
        throw new BusinessException(ErrorCodes.DISCOUNT_EXCEED_RECEIVABLE);
      }
      const received = input.amount - discountAmount;
      if (received < 0) {
        throw new BusinessException(ErrorCodes.RECEIVED_NEGATIVE);
      }

      const orderNo = await this.sequenceService.nextOrderNo(manager, companyId, prefix, seqDate);
      const now = new Date().toISOString();
      const receipt = await manager.save(
        manager.create(ReceiptOrderEntity, {
          companyId,
          projectId: input.projectId,
          customerId: customer.id,
          orderNo,
          chargeType: ChargeType.OTHER,
          snapshotJson: JSON.stringify({
            projectName: project.name,
            roomNo: customer.roomNo,
            customerName: customer.name,
            feeCategoryCode: category.code,
            feeCategoryName: category.name,
          }),
          discountAmount,
          receivableAmount: input.amount,
          receivedAmount: received,
          feeCategoryRef: category.id,
          payerSnapshot: JSON.stringify({
            projectName: project.name,
            customerName: customer.name,
            roomNo: customer.roomNo,
            feeCategoryName: category.name,
            amount: input.amount,
            discountAmount,
            receivedAmount: received,
            paymentMethodCode: input.paymentMethodCode,
            payee: (await manager.findOne(UserEntity, { where: { id: userId } }))?.realName ?? '收费员',
            paidAt: now,
          }),
          status: ReceiptStatus.EFFECTIVE,
          payeeName: (await manager.findOne(UserEntity, { where: { id: userId } }))?.realName ?? '收费员',
          paidAt: now,
          remark: RECEIPT_FIXED_REMARK,
        }),
      );
      const orderId = (receipt as ReceiptOrderEntity).id;

      await manager.save(
        manager.create(ReceiptOrderItemEntity, {
          companyId,
          orderId,
          feeItemCode: FeeItemCode.PROPERTY_FEE,
          feeCategoryRef: category.id,
          calcBasisSnapshot: `${category.name}：固定录入 ${(input.amount / 100).toFixed(2)}元`,
          amount: input.amount,
        }),
      );
      await manager.save(
        manager.create(PaymentRecordEntity, {
          companyId,
          receiptOrderId: orderId,
          methodCode: input.paymentMethodCode,
          channelType: 'offline_record',
          amount: received,
          status: PaymentStatus.SUCCESS,
          operatorId: userId,
          paidAt: now,
        }),
      );

      return {
        orderNo,
        receivableAmount: input.amount,
        discountAmount,
        depositDeduct: 0,
        receivedAmount: received,
        items: [
          {
            feeItemCode: FeeItemCode.PROPERTY_FEE,
            amount: input.amount,
            calcBasis: `${category.name}：固定录入 ${(input.amount / 100).toFixed(2)}元`,
            parameterSnapshot: {},
          },
        ],
        remark: RECEIPT_FIXED_REMARK,
      };
    });
  }

  /* ============ 6.5 收款单查询 ============ */
  async listReceipts(companyId: number, query: { startTime?: string; endTime?: string; chargeType?: ChargeType; feeCategoryCode?: string; roomNo?: string; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .where('r.companyId = :companyId', { companyId })
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (query.startTime) qb.andWhere('r.createdAt >= :startTime', { startTime: query.startTime });
    if (query.endTime) qb.andWhere('r.createdAt <= :endTime', { endTime: query.endTime });
    if (query.chargeType) qb.andWhere('r.chargeType = :chargeType', { chargeType: query.chargeType });
    if (query.roomNo) qb.andWhere("JSON_EXTRACT(r.snapshotJson, '$.roomNo') = :roomNo", { roomNo: query.roomNo });
    const [list, total] = await qb.getManyAndCount();
    let filtered = list;
    if (query.feeCategoryCode) {
      const category = await this.categoryRepo.findOne({ where: { companyId, code: query.feeCategoryCode } });
      filtered = category ? list.filter((r) => r.feeCategoryRef === category.id || r.chargeType !== ChargeType.OTHER) : [];
    }
    const customers = await this.customerRepo.find({ where: { companyId } });
    const customerMap = new Map(customers.map((c) => [c.id, c]));
    const projects = await this.projectRepo.find({ where: { companyId } });
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    return {
      list: filtered.map((r) => {
        const snapshot = JSON.parse(r.snapshotJson || '{}');
        return {
          id: r.id,
          orderNo: r.orderNo,
          projectName: snapshot.projectName ?? projectMap.get(r.projectId)?.name ?? '',
          customerName: snapshot.customerName ?? customerMap.get(r.customerId)?.name ?? '',
          roomNo: snapshot.roomNo ?? customerMap.get(r.customerId)?.roomNo ?? '',
          houseStatus: snapshot.houseStatus ?? customerMap.get(r.customerId)?.houseStatus,
          chargeType: r.chargeType,
          receivableAmount: r.receivableAmount,
          discountAmount: r.discountAmount,
          depositDeduct: r.depositDeduct,
          receivedAmount: r.receivedAmount,
          status: r.status,
          payeeName: r.payeeName,
          paidAt: r.paidAt,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async receiptDetail(companyId: number, orderNo: string) {
    const receipt = await this.receiptRepo.findOne({ where: { companyId, orderNo } });
    if (!receipt) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款单不存在');
    const items = await this.itemRepo.find({ where: { orderId: receipt.id } });
    const snapshot = JSON.parse(receipt.snapshotJson || '{}');
    const customer = await this.customerRepo.findOne({ where: { id: receipt.customerId } });
    return {
      id: receipt.id,
      orderNo: receipt.orderNo,
      projectName: snapshot.projectName ?? '',
      customerName: snapshot.customerName ?? customer?.name ?? '',
      roomNo: snapshot.roomNo ?? customer?.roomNo ?? '',
      houseStatus: snapshot.houseStatus ?? customer?.houseStatus,
      chargeType: receipt.chargeType,
      receivableAmount: receipt.receivableAmount,
      discountAmount: receipt.discountAmount,
      depositDeduct: receipt.depositDeduct,
      receivedAmount: receipt.receivedAmount,
      status: receipt.status,
      payeeName: receipt.payeeName,
      paidAt: receipt.paidAt,
      items: items.map((i) => ({
        feeItemCode: i.feeItemCode,
        amount: i.amount,
        calcBasis: i.calcBasisSnapshot,
        parameterSnapshot: i.parameterSnapshot ? JSON.parse(i.parameterSnapshot) : {},
      })),
      remark: receipt.remark,
      payerSnapshot: JSON.parse(receipt.payerSnapshot || '{}'),
    };
  }
}