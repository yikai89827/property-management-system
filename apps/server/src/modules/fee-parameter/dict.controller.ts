import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

class DictToggleDto {
  @IsBoolean()
  enabled!: boolean;
}

/** 字典管理接口（费用类别/收款方式）：停用后缴费页不可选，历史单据仍可回显 */
@ApiTags('dicts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DictController {
  constructor(
    @InjectRepository(FeeCategoryEntity) private readonly feeCategoryRepo: Repository<FeeCategoryEntity>,
    @InjectRepository(PaymentMethodEntity) private readonly paymentMethodRepo: Repository<PaymentMethodEntity>,
  ) {}

  /** 缴费页只读字典，登录即可；增改仍要 DICT_MANAGE */
  @Get('fee-categories')
  listFeeCategories() {
    return this.feeCategoryRepo.find({
      where: { companyId: TenantContext.getCompanyId()! },
      order: { code: 'ASC' },
    });
  }

  @RequirePermissions(PermissionCodes.DICT_MANAGE)
  @Audit('FEE_CATEGORY_CREATE')
  @Post('fee-categories')
  async createFeeCategory(@Body() dto: DictCreateDto) {
    const companyId = TenantContext.getCompanyId()!;
    const exists = await this.feeCategoryRepo.findOne({ where: { companyId, code: dto.code } });
    if (exists) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '费用类别编码已存在');
    return this.feeCategoryRepo.save(
      this.feeCategoryRepo.create({ companyId, code: dto.code, name: dto.name, enabled: dto.enabled ?? true }),
    );
  }

  @RequirePermissions(PermissionCodes.DICT_MANAGE)
  @Audit('FEE_CATEGORY_TOGGLE')
  @Patch('fee-categories/:id')
  async toggleFeeCategory(@Param('id') id: string, @Body() dto: DictToggleDto) {
    const companyId = TenantContext.getCompanyId()!;
    const row = await this.feeCategoryRepo.findOne({ where: { id: Number(id), companyId } });
    if (!row) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '费用类别不存在');
    row.enabled = dto.enabled;
    return this.feeCategoryRepo.save(row);
  }

  @Get('payment-methods')
  listPaymentMethods() {
    return this.paymentMethodRepo.find({
      where: { companyId: TenantContext.getCompanyId()! },
      order: { code: 'ASC' },
    });
  }

  @RequirePermissions(PermissionCodes.DICT_MANAGE)
  @Audit('PAYMENT_METHOD_CREATE')
  @Post('payment-methods')
  async createPaymentMethod(@Body() dto: DictCreateDto) {
    const companyId = TenantContext.getCompanyId()!;
    const exists = await this.paymentMethodRepo.findOne({ where: { companyId, code: dto.code } });
    if (exists) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款方式编码已存在');
    return this.paymentMethodRepo.save(
      this.paymentMethodRepo.create({ companyId, code: dto.code, name: dto.name, enabled: dto.enabled ?? true }),
    );
  }

  @RequirePermissions(PermissionCodes.DICT_MANAGE)
  @Audit('PAYMENT_METHOD_TOGGLE')
  @Patch('payment-methods/:id')
  async togglePaymentMethod(@Param('id') id: string, @Body() dto: DictToggleDto) {
    const companyId = TenantContext.getCompanyId()!;
    const row = await this.paymentMethodRepo.findOne({ where: { id: Number(id), companyId } });
    if (!row) throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '收款方式不存在');
    row.enabled = dto.enabled;
    return this.paymentMethodRepo.save(row);
  }
}
