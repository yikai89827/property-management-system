import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PermissionCodes, ReceiptStatus } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Audit } from '../../common/interceptors/audit.decorator';
import { PaymentService } from './payment.service';

class RejectDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /** 收款记录列表（pending 待确认筛选） */
  @RequirePermissions(PermissionCodes.PAYMENT_RECORD_CONFIRM)
  @Get('payments/records')
  list(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.paymentService.listRecords(
      TenantContext.getCompanyId()!,
      status as ReceiptStatus,
      page ? Number(page) : undefined,
      pageSize ? Number(pageSize) : undefined,
    );
  }

  /** 确认到账：单据生效、核销欠费、生成电子收据、触发通知 */
  @RequirePermissions(PermissionCodes.PAYMENT_RECORD_CONFIRM)
  @Audit('PAYMENT_CONFIRM')
  @Post('payments/records/:id/confirm')
  confirm(@Param('id') id: string) {
    return this.paymentService.confirm(Number(id));
  }

  /** 驳回：冲销单据、解锁月段、通知业主 */
  @RequirePermissions(PermissionCodes.PAYMENT_RECORD_CONFIRM)
  @Audit('PAYMENT_REJECT')
  @Post('payments/records/:id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) {
    return this.paymentService.reject(Number(id), dto.reason ?? '');
  }
}

/** 支付渠道回调（公开接口，无需登录；一期占位） */
@ApiTags('payment-callbacks')
@Controller('payment-callbacks')
export class PaymentCallbackController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post(':channelType')
  callback(@Param('channelType') channelType: string, @Body() body: unknown) {
    return this.paymentService.handleCallback(channelType, body);
  }
}