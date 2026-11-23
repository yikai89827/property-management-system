import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ErrorCodes, LedgerStatus, PaymentStatus, ReceiptStatus, ChargeType, FeeItemCode } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { JwtService } from '@nestjs/jwt';
import { TenantService } from '../../common/tenant/tenant.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CustomerEntity, PersonEntity, ProjectEntity, VehiclePlateEntity } from '../../database/entities/org-entities';
import {
  OwnerVerifyAttemptEntity,
  PaymentRecordEntity,
  PropertyFeeLedgerEntity,
  ReceiptOrderEntity,
  ReceiptOrderItemEntity,
  PaymentMethodEntity,
} from '../../database/entities/charging-entities';
import { FeeCalculationService } from '../fee-calculation/fee-calculation.service';
import { SequenceService } from '../charging/sequence.service';
import { AuthService } from '../auth/auth.service';
import { RECEIPT_FIXED_REMARK } from '@pms/shared';
import { isValidIdCard } from '../../common/crypto/crypto.service';

const MAX_FAIL_COUNT = 5;
const LOCK_MINUTES = 30;

/** 业主端服务（一期收款登记模式） */
@Injectable()
export class OwnerService {
  private readonly crypto = new CryptoService();

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly feeCalculationService: FeeCalculationService,
    private readonly sequenceService: SequenceService,
    private readonly tenantService: TenantService,
    private readonly authService: AuthService,
    @InjectRepository(CustomerEntity) private readonly customerRepo: Repository<CustomerEntity>,
    @InjectRepository(PersonEntity) private readonly personRepo: Repository<PersonEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(PaymentMethodEntity) private readonly methodRepo: Repository<PaymentMethodEntity>,
    @InjectRepository(OwnerVerifyAttemptEntity) private readonly attemptRepo: Repository<OwnerVerifyAttemptEntity>,
    @InjectRepository(ReceiptOrderEntity) private readonly receiptRepo: Repository<ReceiptOrderEntity>,
    @InjectRepository(PaymentRecordEntity) private readonly paymentRepo: Repository<PaymentRecordEntity>,
    @InjectRepository(VehiclePlateEntity) private readonly plateRepo: Repository<VehiclePlateEntity>,
  ) {}

  /**
   * 业主/租户身份匹配（身份证为唯一标识）：
   * - 优先：projectId + idCard（+ 可选 roomNo，一人多房时消歧）
   * - 兼容：projectId + roomId + name + phoneLast4
   */
  async verify(input: {
    projectId: number;
    idCard?: string;
    roomId?: string;
    name?: string;
    phoneLast4?: string;
    customerId?: number;
  }) {
    const project = await this.projectRepo.findOne({ where: { id: input.projectId } });
    if (!project) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '项目不存在');
    const companyId = project.companyId;
    const attemptKey = (input.idCard?.trim().toUpperCase() || input.roomId || 'unknown').slice(0, 64);
    const today = new Date().toISOString().slice(0, 10);
    let attempt = await this.attemptRepo.findOne({
      where: { companyId, projectId: input.projectId, roomNo: attemptKey, attemptDate: today },
    });
    if (attempt?.lockedUntil && new Date(attempt.lockedUntil) > new Date()) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '验证失败次数过多，请 30 分钟后再试');
    }
    if (!attempt) {
      attempt = await this.attemptRepo.save(
        this.attemptRepo.create({
          companyId,
          projectId: input.projectId,
          roomNo: attemptKey,
          failCount: 0,
          attemptDate: today,
        }),
      );
    }

    const fail = async () => {
      attempt!.failCount += 1;
      if (attempt!.failCount >= MAX_FAIL_COUNT) {
        attempt!.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
      }
      await this.attemptRepo.save(attempt!);
      throw new BusinessException(ErrorCodes.OWNER_VERIFY_MISMATCH);
    };

    let matched: CustomerEntity | undefined;

    if (input.idCard) {
      const idCard = input.idCard.trim().toUpperCase();
      if (!isValidIdCard(idCard)) throw new BusinessException(ErrorCodes.ID_CARD_INVALID);
      const blind = this.crypto.blindIndex(idCard);
      const person = await this.personRepo.findOne({ where: { companyId, idCardBlindIndex: blind } });
      if (!person) await fail();
      const units = (
        await this.customerRepo.find({ where: { companyId, projectId: input.projectId, personId: person!.id } })
      ).filter((c) => !c.deletedAt);

      if (input.customerId) {
        matched = units.find((c) => c.id === input.customerId);
      } else if (input.roomId) {
        matched = units.find((c) => c.roomNo === input.roomId);
      } else if (units.length === 1) {
        matched = units[0];
      } else if (units.length > 1) {
        // 同一项目下一人多房：返回候选列表，由前端二次选择
        attempt.failCount = 0;
        await this.attemptRepo.save(attempt);
        return {
          needSelectProperty: true,
          properties: units.map((c) => ({
            customerId: c.id,
            roomNo: c.roomNo,
            residentType: c.residentType,
            houseStatus: c.houseStatus,
            projectId: c.projectId,
            projectName: project.name,
          })),
        };
      }
    } else if (input.roomId && input.name && input.phoneLast4) {
      const customers = await this.customerRepo.find({
        where: { companyId, projectId: input.projectId, roomNo: input.roomId },
      });
      matched = customers.find((c) => {
        if (c.deletedAt || c.name !== input.name) return false;
        const phone = this.crypto.decrypt(c.phoneEncrypted);
        return phone.endsWith(input.phoneLast4!);
      });
    } else {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '请使用身份证号验证，或填写房号/姓名/手机后四位');
    }

    if (!matched) await fail();

    attempt.failCount = 0;
    await this.attemptRepo.save(attempt);

    const ttl = Number(process.env.JWT_OWNER_TTL ?? 7200);
    const ownerToken = this.authService.issueOwnerToken(companyId, matched!.id, ttl);

    // 跨项目房源摘要（便于业主端展示多小区资产）
    const allUnits =
      matched!.personId != null
        ? (await this.customerRepo.find({ where: { companyId, personId: matched!.personId } })).filter((c) => !c.deletedAt)
        : [matched!];
    const projectIds = [...new Set(allUnits.map((u) => u.projectId))];
    const projects = projectIds.length ? await this.projectRepo.find({ where: { id: In(projectIds) } }) : [];
    const nameMap = new Map(projects.map((p) => [p.id, p.name]));

    return {
      ownerToken,
      needSelectProperty: false,
      customerBrief: {
        name: matched!.name,
        roomNo: matched!.roomNo,
        houseStatus: matched!.houseStatus,
        residentType: matched!.residentType,
        projectId: matched!.projectId,
        projectName: project.name,
      },
      allProperties: allUnits.map((c) => ({
        customerId: c.id,
        roomNo: c.roomNo,
        residentType: c.residentType,
        houseStatus: c.houseStatus,
        projectId: c.projectId,
        projectName: nameMap.get(c.projectId) ?? '',
      })),
    };
  }

  /** 我的欠费信息（仅令牌绑定 customer_id 本人） */
  async arrears(customerId: number) {
    const companyId = this.tenantService.requireCompanyId();
    const customer = await this.customerRepo.findOne({ where: { id: customerId, companyId } });
    if (!customer) throw new BusinessException(ErrorCodes.UNAUTHORIZED, undefined, 401);
    const ledgers = await this.dataSource.getRepository(PropertyFeeLedgerEntity).find({
      where: { companyId, customerId },
    });
    const ctx = await this.feeCalculationService.resolveParameters(companyId, customer.projectId);
    const totalBillableMonths = this.feeCalculationService.totalBillableMonths(customer.feeStartDate);
    const paidMonths = this.feeCalculationService.paidMonths(ledgers);
    const remainingMonths = Math.max(0, totalBillableMonths - paidMonths);
    return {
      feeStartMonth: customer.feeStartDate.slice(0, 7),
      totalBillableMonths,
      paidMonths,
      remainingMonths,
      arrearsMonths: remainingMonths,
      arrearsAmount: Math.round((customer.houseArea * ctx.unitPrice) / 100) * remainingMonths,
      paidLedgers: ledgers.map((l) => ({ startMonth: l.startMonth, endMonth: l.endMonth, months: l.months, status: l.status })),
    };
  }

  /** 业主缴费提交（月段预占）：单事务内发号 + 收款单 pending + 月段 pending 阻止重复提交 */
  async submitPropertyCharge(
    customerId: number,
    input: { months: number; startMonth: string; declaredPaymentMethodCode: string; declaredTradeNo?: string },
  ) {
    const companyId = this.tenantService.requireCompanyId();
    const prefix = process.env.RECEIPT_NO_PREFIX ?? 'PM';
    const seqDate = new Date().toISOString().slice(0, 10);

    if (!Number.isInteger(input.months) || input.months <= 0) {
      throw new BusinessException(ErrorCodes.CHARGE_MONTHS_INVALID);
    }

    return this.dataSource.transaction(async (manager) => {
      const customer = await manager.findOne(CustomerEntity, { where: { id: customerId, companyId } });
      if (!customer) throw new BusinessException(ErrorCodes.UNAUTHORIZED, undefined, 401);
      const ledgers = await manager.find(PropertyFeeLedgerEntity, { where: { companyId, customerId } });
      const ctx = await this.feeCalculationService.resolveParameters(companyId, customer.projectId);

      // 重复提交拦截：同月段 pending/effective 预占
      if (FeeCalculationService.hasOverlap(input.startMonth, input.months, ledgers)) {
        throw new BusinessException(ErrorCodes.DUPLICATE_PAYMENT);
      }
      // 月数不超剩余应交
      const totalBillableMonths = this.feeCalculationService.totalBillableMonths(customer.feeStartDate);
      const paidMonths = this.feeCalculationService.paidMonths(ledgers);
      const remainingMonths = Math.max(0, totalBillableMonths - paidMonths);
      if (remainingMonths === 0) {
        throw new BusinessException(ErrorCodes.PROPERTY_FEE_PAID_OFF);
      }
      if (input.months > remainingMonths) {
        throw new BusinessException(ErrorCodes.CHARGE_MONTHS_INVALID);
      }

      const receivable = Math.round((customer.houseArea * ctx.unitPrice) / 100) * input.months;
      const project = await manager.findOne(ProjectEntity, { where: { id: customer.projectId } });
      const orderNo = await this.sequenceService.nextOrderNo(manager, companyId, prefix, seqDate);
      const now = new Date().toISOString();
      const endMonth = FeeCalculationService.addMonths(input.startMonth, input.months - 1);

      const receipt = await manager.save(
        manager.create(ReceiptOrderEntity, {
          companyId,
          projectId: customer.projectId,
          customerId,
          orderNo,
          chargeType: ChargeType.PROPERTY,
          snapshotJson: JSON.stringify({
            projectName: project?.name ?? '',
            roomNo: customer.roomNo,
            customerName: customer.name,
            houseAreaFen: customer.houseArea,
          }),
          receivableAmount: receivable,
          receivedAmount: receivable,
          payerSnapshot: JSON.stringify({
            projectName: project?.name ?? '',
            customerName: customer.name,
            roomNo: customer.roomNo,
            declaredPaymentMethodCode: input.declaredPaymentMethodCode,
            declaredTradeNo: input.declaredTradeNo,
            feeStartMonth: input.startMonth,
            feeEndMonth: endMonth,
            months: input.months,
          }),
          status: ReceiptStatus.PENDING,
          payeeName: '待物业确认',
          remark: RECEIPT_FIXED_REMARK,
        }),
      );
      const orderId = (receipt as ReceiptOrderEntity).id;

      await manager.save(
        manager.create(ReceiptOrderItemEntity, {
          companyId,
          orderId,
          feeItemCode: FeeItemCode.PROPERTY_FEE,
          calcBasisSnapshot: `${(customer.houseArea / 100).toFixed(2)}㎡ × ${ctx.unitPrice}分/㎡/月 × ${input.months}个月（${input.startMonth} 至 ${endMonth}）`,
          amount: receivable,
        }),
      );

      // 月段台账预占（pending，阻止同月段重复提交）
      await manager.save(
        manager.create(PropertyFeeLedgerEntity, {
          companyId,
          customerId,
          receiptOrderId: orderId,
          startMonth: input.startMonth,
          endMonth,
          months: input.months,
          unitPriceSnapshot: ctx.unitPrice,
          areaSnapshot: customer.houseArea,
          status: LedgerStatus.PENDING,
        }),
      );

      // 业主申报付款方式与流水号备查（pending）
      await manager.save(
        manager.create(PaymentRecordEntity, {
          companyId,
          receiptOrderId: orderId,
          methodCode: input.declaredPaymentMethodCode,
          channelType: 'offline_record',
          channelTradeNo: input.declaredTradeNo ?? `DECLARED-${orderNo}`,
          amount: receivable,
          status: PaymentStatus.PENDING,
          paidAt: now,
        }),
      );

      return { orderNo, amount: receivable, status: ReceiptStatus.PENDING, months: input.months, startMonth: input.startMonth, endMonth };
    });
  }

  /** 我的电子收据列表（全部历史收据分页） */
  async receipts(customerId: number, page = 1, pageSize = 20) {
    const companyId = this.tenantService.requireCompanyId();
    const qb = this.receiptRepo
      .createQueryBuilder('r')
      .where('r.companyId = :companyId', { companyId })
      .andWhere('r.customerId = :customerId', { customerId })
      .orderBy('r.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [list, total] = await qb.getManyAndCount();
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    const project = customer ? await this.projectRepo.findOne({ where: { id: customer.projectId } }) : null;
    return {
      list: list.map((r) => {
        const snapshot = JSON.parse(r.snapshotJson || '{}');
        return {
          orderNo: r.orderNo,
          projectName: snapshot.projectName ?? project?.name ?? '',
          chargeType: r.chargeType,
          receivableAmount: r.receivableAmount,
          discountAmount: r.discountAmount,
          depositDeduct: r.depositDeduct,
          receivedAmount: r.receivedAmount,
          paidAt: r.paidAt,
          status: r.status,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 电子收据详情（与收款单同编号同金额） */
  async receiptDetail(customerId: number, orderNo: string) {
    const companyId = this.tenantService.requireCompanyId();
    const receipt = await this.receiptRepo.findOne({ where: { companyId, orderNo, customerId } });
    if (!receipt) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收据不存在');
    const items = await this.dataSource.getRepository(ReceiptOrderItemEntity).find({ where: { orderId: receipt.id } });
    const snapshot = JSON.parse(receipt.snapshotJson || '{}');
    return {
      orderNo: receipt.orderNo,
      projectName: snapshot.projectName ?? '',
      chargeType: receipt.chargeType,
      receivableAmount: receipt.receivableAmount,
      discountAmount: receipt.discountAmount,
      depositDeduct: receipt.depositDeduct,
      receivedAmount: receipt.receivedAmount,
      paidAt: receipt.paidAt,
      status: receipt.status,
      items: items.map((i) => ({ feeItemCode: i.feeItemCode, amount: i.amount, calcBasis: i.calcBasisSnapshot })),
      remark: receipt.remark,
    };
  }

  /** 业主端可用收款方式（申报付款方式字典） */
  async paymentMethods(companyId: number) {
    return this.methodRepo.find({ where: { companyId, enabled: true } });
  }
}