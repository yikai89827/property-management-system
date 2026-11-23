import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ChargeType, DiscountType, PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Audit } from '../../common/interceptors/audit.decorator';
import { ChargingService } from './charging.service';

class DeliveryChargeDto {
  projectId!: string;

  @IsString()
  @MinLength(1)
  roomNo!: string;

  @IsOptional()
  @IsIn(Object.values(DiscountType))
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  depositDeduct?: number;

  @IsString()
  paymentMethodCode!: string;
}

class PropertyChargeDto extends DeliveryChargeDto {
  @IsInt()
  @Min(1)
  months!: number;

  @IsString()
  startMonth!: string;
}

class OtherChargeDto {
  projectId!: string;

  @IsString()
  @MinLength(1)
  roomNo!: string;

  @IsString()
  feeCategoryCode!: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsString()
  paymentMethodCode!: string;
}

@ApiTags('charges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ChargingController {
  constructor(private readonly chargingService: ChargingService) {}

  /** 交房缴费提交（单事务：单据+明细+台账+支付记录+状态联动，任一步失败整体回滚） */
  @RequirePermissions(PermissionCodes.CHARGE_DELIVERY_EXECUTE)
  @Audit('CHARGE_DELIVERY')
  @Post('charges/delivery')
  chargeDelivery(@Body() dto: DeliveryChargeDto) {
    return this.chargingService.chargeDelivery({
      projectId: Number(dto.projectId),
      roomNo: dto.roomNo,
      discountType: dto.discountType,
      discountAmount: dto.discountAmount,
      depositDeduct: dto.depositDeduct,
      paymentMethodCode: dto.paymentMethodCode,
    });
  }

  /** 物业费续费提交（单事务 + 月段台账） */
  @RequirePermissions(PermissionCodes.CHARGE_PROPERTY_EXECUTE)
  @Audit('CHARGE_PROPERTY')
  @Post('charges/property')
  chargeProperty(@Body() dto: PropertyChargeDto) {
    return this.chargingService.chargeProperty({
      projectId: Number(dto.projectId),
      roomNo: dto.roomNo,
      months: dto.months,
      startMonth: dto.startMonth,
      discountType: dto.discountType,
      discountAmount: dto.discountAmount,
      depositDeduct: dto.depositDeduct,
      paymentMethodCode: dto.paymentMethodCode,
    });
  }

  /** 其他缴费提交 */
  @RequirePermissions(PermissionCodes.CHARGE_OTHER_EXECUTE)
  @Audit('CHARGE_OTHER')
  @Post('charges/other')
  chargeOther(@Body() dto: OtherChargeDto) {
    return this.chargingService.chargeOther({
      projectId: Number(dto.projectId),
      roomNo: dto.roomNo,
      feeCategoryCode: dto.feeCategoryCode,
      amount: dto.amount,
      discountAmount: dto.discountAmount,
      paymentMethodCode: dto.paymentMethodCode,
    });
  }

  /** 收款单分页查询（时间/缴费类型/费用类别/房号条件） */
  @RequirePermissions(PermissionCodes.CHARGE_RECEIPT_VIEW)
  @Get('charges')
  list(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('chargeType') chargeType?: ChargeType,
    @Query('feeCategoryCode') feeCategoryCode?: string,
    @Query('roomNo') roomNo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.chargingService.listReceipts(TenantContext.getCompanyId()!, {
      startTime,
      endTime,
      chargeType,
      feeCategoryCode,
      roomNo,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** 收款单详情（明细 + 计算依据快照 + 固定备注） */
  @RequirePermissions(PermissionCodes.CHARGE_RECEIPT_VIEW)
  @Get('charges/:orderNo')
  detail(@Param('orderNo') orderNo: string) {
    return this.chargingService.receiptDetail(TenantContext.getCompanyId()!, orderNo);
  }
}