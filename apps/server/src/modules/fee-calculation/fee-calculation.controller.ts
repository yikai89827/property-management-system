import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import {
  ErrorCodes,
  HOUSE_STATUS_LABELS,
  isVacantDiscountEligible,
  PermissionCodes,
} from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PropertyFeeLedgerEntity } from '../../database/entities/charging-entities';
import { CustomerService } from '../customer/customer.service';
import { FeeCalculationService } from './fee-calculation.service';

class PreviewDto {
  @IsString()
  projectId!: string;

  @IsString()
  roomNo!: string;

  @IsOptional()
  @IsNumber()
  months?: number;
}

@ApiTags('fees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fees')
export class FeeCalculationController {
  constructor(
    private readonly feeCalculationService: FeeCalculationService,
    private readonly customerService: CustomerService,
    @InjectRepository(PropertyFeeLedgerEntity) private readonly ledgerRepo: Repository<PropertyFeeLedgerEntity>,
  ) {}

  private companyId(): number {
    return TenantContext.getCompanyId()!;
  }

  /** 交房费用预览（无副作用）：四项费用明细 + 合计应交 + 计算依据 + 参数快照 */
  @RequirePermissions(PermissionCodes.CHARGE_DELIVERY_EXECUTE)
  @Post('preview/delivery')
  async previewDelivery(@Body() dto: PreviewDto) {
    const projectId = Number(dto.projectId);
    const customer = await this.customerService.getByRoomNo(this.companyId(), projectId, dto.roomNo);
    const ledgers = await this.ledgerRepo.find({ where: { companyId: this.companyId(), customerId: customer.id } });
    const ctx = await this.feeCalculationService.resolveParameters(
      this.companyId(),
      projectId,
      customer.propertyType,
    );
    const arrearsMonths = this.feeCalculationService.arrearsMonthsFor(customer, ledgers);
    const feeItems = this.feeCalculationService.calcDeliveryFees(
      customer.houseArea,
      arrearsMonths,
      ctx,
      customer.feeStartDate,
    );
    const vacantEligible = isVacantDiscountEligible(customer.houseStatus);
    const depositDeductAllowed = await this.customerService.hasActiveDecorateFiling(this.companyId(), customer.id);
    const feeStartMonth = FeeCalculationService.monthOf(customer.feeStartDate);
    const feeEndMonth = FeeCalculationService.monthOf(new Date().toISOString());
    return {
      customer: {
        ...this.customerService.toSummary(customer),
        houseStatusLabel: HOUSE_STATUS_LABELS[customer.houseStatus as keyof typeof HOUSE_STATUS_LABELS],
        feeStartDate: customer.feeStartDate,
        decorateDate: customer.decorateDate ?? null,
        vacantEligible,
        depositDeductAllowed,
      },
      arrearsMonths,
      feeStartMonth,
      feeEndMonth,
      feeItems,
      totalReceivable: feeItems.reduce((sum, f) => sum + f.amount, 0),
    };
  }

  /** 物业费续费预览（计费信息卡）：起止月/累计计费月数/已缴/剩余/面积/单价/应交金额 */
  @RequirePermissions(PermissionCodes.CHARGE_PROPERTY_EXECUTE)
  @Post('preview/property')
  async previewProperty(@Body() dto: PreviewDto) {
    const projectId = Number(dto.projectId);
    const customer = await this.customerService.getByRoomNo(this.companyId(), projectId, dto.roomNo);
    const ledgers = await this.ledgerRepo.find({ where: { companyId: this.companyId(), customerId: customer.id } });
    const ctx = await this.feeCalculationService.resolveParameters(
      this.companyId(),
      projectId,
      customer.propertyType,
    );

    const totalBillableMonths = this.feeCalculationService.totalBillableMonths(customer.feeStartDate);
    const paidMonths = this.feeCalculationService.paidMonths(ledgers);
    const remainingMonths = Math.max(0, totalBillableMonths - paidMonths);
    if (remainingMonths === 0) {
      throw new BusinessException(ErrorCodes.PROPERTY_FEE_PAID_OFF, '该客户物业费已缴清');
    }
    const months = dto.months ?? remainingMonths;
    const feeStartMonth = this.feeCalculationService.earliestUnpaidMonth(customer.feeStartDate, ledgers);
    const feeEndMonth = FeeCalculationService.addMonths(feeStartMonth, months - 1);
    const unitPrice = ctx.unitPrice;
    const propertyItem = this.feeCalculationService.calcPropertyFeeMonthsWithProration(
      customer.houseArea,
      feeStartMonth,
      months,
      customer.feeStartDate,
      ctx,
    );
    const arrearsItem = this.feeCalculationService.calcPropertyFeeMonthsWithProration(
      customer.houseArea,
      feeStartMonth,
      remainingMonths,
      customer.feeStartDate,
      ctx,
    );
    const vacantEligible = isVacantDiscountEligible(customer.houseStatus);
    const depositDeductAllowed = await this.customerService.hasActiveDecorateFiling(this.companyId(), customer.id);

    return {
      customer: {
        ...this.customerService.toSummary(customer),
        houseStatusLabel: HOUSE_STATUS_LABELS[customer.houseStatus as keyof typeof HOUSE_STATUS_LABELS],
        feeStartDate: customer.feeStartDate,
        decorateDate: customer.decorateDate ?? null,
        vacantEligible,
        depositDeductAllowed,
      },
      billingInfo: {
        feeStartMonth,
        feeEndMonth,
        billableFromMonth: FeeCalculationService.monthOf(customer.feeStartDate),
        billableToMonth: FeeCalculationService.monthOf(new Date().toISOString()),
        totalBillableMonths,
        paidMonths,
        remainingMonths,
        arrearsMonths: remainingMonths,
        arrearsAmount: arrearsItem.amount,
        houseAreaSnapshot: customer.houseArea,
        unitPriceSnapshot: unitPrice,
        months,
        receivableAmount: propertyItem.amount,
        calcBasis: propertyItem.calcBasis,
      },
    };
  }

  /** 客户欠费状态查询（口径与台账一致） */
  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('fee-status')
  async feeStatus(@Query('customerId') customerId: string, @Query('asOf') asOf?: string) {
    const customer = await this.customerService.getOrThrow(this.companyId(), Number(customerId));
    const ledgers = await this.ledgerRepo.find({ where: { companyId: this.companyId(), customerId: customer.id } });
    const asOfMonth = asOf && /^\d{4}-\d{2}$/.test(asOf) ? asOf : FeeCalculationService.monthOf(new Date().toISOString());
    const feeStartMonth = FeeCalculationService.monthOf(customer.feeStartDate);
    const totalBillableMonths = this.feeCalculationService.totalBillableMonthsAsOf(customer.feeStartDate, asOfMonth);
    const paidMonths = this.feeCalculationService.paidMonthsUpTo(ledgers, asOfMonth);
    const remainingMonths = Math.max(0, totalBillableMonths - paidMonths);
    const ctx = await this.feeCalculationService.resolveParameters(
      this.companyId(),
      customer.projectId,
      customer.propertyType,
    );
    const unpaidStart = this.feeCalculationService.earliestUnpaidMonth(
      customer.feeStartDate,
      ledgers,
      new Date(`${asOfMonth}-28T00:00:00Z`),
    );
    const arrearsAmount =
      remainingMonths > 0
        ? this.feeCalculationService.calcPropertyFeeMonthsWithProration(
            customer.houseArea,
            unpaidStart,
            remainingMonths,
            customer.feeStartDate,
            ctx,
          ).amount
        : 0;
    return {
      feeStartDate: customer.feeStartDate,
      feeStartMonth,
      feeEndMonth: asOfMonth,
      totalBillableMonths,
      paidMonths,
      remainingMonths,
      arrearsMonths: remainingMonths,
      arrearsAmount,
      unitPrice: ctx.unitPrice,
      propertyType: customer.propertyType ?? 'RESIDENTIAL',
      paidLedgers: ledgers.map((l) => ({ startMonth: l.startMonth, endMonth: l.endMonth, months: l.months, status: l.status })),
    };
  }
}