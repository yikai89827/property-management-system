import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { TenantContext } from '../../common/tenant/tenant-context';
import { OwnerScopeGuard, Public } from '../../common/guards/owner-scope.guard';
import { OwnerService } from './owner.service';

export class OwnerVerifyDto {
  @IsString()
  projectId!: string;

  /** 身份证号（业主/租户唯一标识，推荐） */
  @IsOptional()
  @IsString()
  idCard?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  phoneLast4?: string;

  /** 一人多房时指定房屋档案 */
  @IsOptional()
  @IsNumber()
  customerId?: number;
}

export class OwnerChargePropertyDto {
  @IsInt()
  @Min(1)
  months!: number;

  @IsString()
  startMonth!: string;

  @IsString()
  declaredPaymentMethodCode!: string;

  @IsOptional()
  @IsString()
  declaredTradeNo?: string;
}

/**
 * 业主端接口（短期令牌 aud=owner 仅可访问 /owner/*）：
 * /owner/auth/verify 为公开接口（三要素匹配），其余需业主令牌。
 */
@ApiTags('owner')
@UseGuards(OwnerScopeGuard)
@Controller('owner')
export class OwnerController {
  constructor(private readonly ownerService: OwnerService) {}

  @Public()
  @Post('auth/verify')
  verify(@Body() dto: OwnerVerifyDto) {
    return this.ownerService.verify({
      projectId: Number(dto.projectId),
      idCard: dto.idCard,
      roomId: dto.roomId,
      name: dto.name,
      phoneLast4: dto.phoneLast4,
      customerId: dto.customerId ? Number(dto.customerId) : undefined,
    });
  }

  @Get('arrears')
  arrears() {
    const customerId = TenantContext.get()?.customerId;
    if (!customerId) throw new Error('owner context missing');
    return this.ownerService.arrears(customerId);
  }

  @Get('payment-methods')
  paymentMethods() {
    return this.ownerService.paymentMethods(TenantContext.getCompanyId()!);
  }

  /** 业主缴费提交（月段预占，一期收款登记模式） */
  @Post('charges/property')
  submitCharge(@Body() dto: OwnerChargePropertyDto) {
    const customerId = TenantContext.get()?.customerId;
    if (!customerId) throw new Error('owner context missing');
    return this.ownerService.submitPropertyCharge(customerId, {
      months: dto.months,
      startMonth: dto.startMonth,
      declaredPaymentMethodCode: dto.declaredPaymentMethodCode,
      declaredTradeNo: dto.declaredTradeNo,
    });
  }

  @Get('receipts')
  receipts(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const customerId = TenantContext.get()?.customerId;
    if (!customerId) throw new Error('owner context missing');
    return this.ownerService.receipts(customerId, page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined);
  }

  @Get('receipts/:orderNo')
  receiptDetail(@Param('orderNo') orderNo: string) {
    const customerId = TenantContext.get()?.customerId;
    if (!customerId) throw new Error('owner context missing');
    return this.ownerService.receiptDetail(customerId, orderNo);
  }
}