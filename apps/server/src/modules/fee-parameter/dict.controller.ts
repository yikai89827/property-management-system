import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Audit } from '../../common/interceptors/audit.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeeCategoryEntity, PaymentMethodEntity } from '../../database/entities/charging-entities';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCodes } from '@pms/shared';

class DictCreateDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 字典管理接口（费用类别/收款方式）：新增类别后其他缴费立即可选且零代码变更 */
@ApiTags('dicts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DictController {
  constructor(
    @InjectRepository(FeeCategoryEntity) private readonly feeCategoryRepo: Repository<FeeCategoryEntity>,
    @InjectRepository(PaymentMethodEntity) private readonly paymentMethodRepo: Repository<PaymentMethodEntity>,
  ) {}

  /** 缴费页只读字典，登录即可；增删改仍要 DICT_MANAGE */
  @Get('fee-categories')
  listFeeCategories() {
    return this.feeCategoryRepo.find({ where: { companyId: TenantContext.getCompanyId()! } });
  }

  @RequirePermissions(PermissionCodes.DICT_MANAGE)
  @Audit('FEE_CATEGORY_CREATE')
  @Post('fee-categories')
  async createFeeCategory(@Body() dto: DictCreateDto) {
    const companyId = TenantContext.getCompanyId()!;
    const exists = await this.feeCategoryRepo.findOne({ where: { companyId, code: dto.code } });
    if (exists) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '费用类别编码已存在');
    return this.feeCategoryRepo.save(this.feeCategoryRepo.create({ companyId, code: dto.code, name: dto.name, enabled: dto.enabled ?? true }));
  }

  @Get('payment-methods')
  listPaymentMethods() {
    return this.paymentMethodRepo.find({ where: { companyId: TenantContext.getCompanyId()! } });
  }

  @RequirePermissions(PermissionCodes.DICT_MANAGE)
  @Audit('PAYMENT_METHOD_CREATE')
  @Post('payment-methods')
  async createPaymentMethod(@Body() dto: DictCreateDto) {
    const companyId = TenantContext.getCompanyId()!;
    const exists = await this.paymentMethodRepo.findOne({ where: { companyId, code: dto.code } });
    if (exists) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款方式编码已存在');
    return this.paymentMethodRepo.save(this.paymentMethodRepo.create({ companyId, code: dto.code, name: dto.name, enabled: dto.enabled ?? true }));
  }
}