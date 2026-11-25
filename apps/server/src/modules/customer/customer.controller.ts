import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { ErrorCodes, HouseStatus, HOUSE_STATUS_LABELS, PermissionCodes, ResidentType } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Audit } from '../../common/interceptors/audit.decorator';
import { CustomerService } from './customer.service';

class CreateCustomerDto {
  @IsNumber()
  projectId!: number;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  phone!: string;

  @IsString()
  @MinLength(1)
  roomNo!: string;

  @IsString()
  @MinLength(15)
  idCard!: string;

  @IsNumber()
  houseArea!: number;

  @IsOptional()
  @IsString()
  contractDate?: string;

  @IsString()
  feeStartDate!: string;

  @IsOptional()
  @IsString()
  decorateDate?: string;

  @IsIn(Object.values(HouseStatus))
  houseStatus!: HouseStatus;

  @IsOptional()
  @IsIn(Object.values(ResidentType))
  residentType?: ResidentType;

  @IsOptional()
  @IsObject()
  ext?: Record<string, unknown>;
}

class UpdateCustomerDto {
  @IsOptional() name?: string;
  @IsOptional() phone?: string;
  @IsOptional() idCard?: string;
  @IsOptional() houseArea?: number;
  @IsOptional() contractDate?: string;
  @IsOptional() feeStartDate?: string;
  @IsOptional() decorateDate?: string;
  @IsOptional()
  @IsIn(Object.values(ResidentType))
  residentType?: ResidentType;
  @IsOptional() @IsObject() ext?: Record<string, unknown>;
}

class TransitionStatusDto {
  @IsIn(Object.values(HouseStatus))
  target!: HouseStatus;
}

class PlateDto {
  @IsString()
  plateNo!: string;
}

class ExtKeyDto {
  @IsString()
  keyName!: string;

  @IsString()
  displayName!: string;

  @IsOptional() @IsString() valueType?: string;

  @IsOptional() @IsBoolean() required?: boolean;

  @IsOptional() @IsString() validationRule?: string;
}

class ResaleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  phone!: string;

  @IsString()
  @MinLength(15)
  idCard!: string;

  @IsOptional()
  @IsIn(Object.values(ResidentType))
  residentType?: ResidentType;

  @IsOptional()
  @IsString()
  contractDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

class DecorateFilingDto {
  @IsString()
  startDate!: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

class CloseDecorateDto {
  @IsOptional()
  @IsString()
  endDate?: string;
}

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  private companyId(): number {
    return TenantContext.getCompanyId()!;
  }

  private userId(): number {
    return TenantContext.getUserId()!;
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_CREATE)
  @Audit('CUSTOMER_CREATE')
  @Post('customers')
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create({ ...dto, houseStatus: dto.houseStatus });
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('customers')
  list(
    @Query('projectId') projectId?: string,
    @Query('roomNo') roomNo?: string,
    @Query('name') name?: string,
    @Query('phone') phone?: string,
    @Query('idCard') idCard?: string,
    @Query('residentType') residentType?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.customerService.list(this.companyId(), {
      projectId: projectId ? Number(projectId) : undefined,
      roomNo,
      name,
      phone,
      idCard,
      residentType,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  /** 按身份证查询跨项目房源（自然人唯一身份） */
  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('customers/by-id-card')
  listByIdCard(@Query('idCard') idCard: string) {
    return this.customerService.listByIdCard(this.companyId(), idCard ?? '');
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('customers/:id')
  detail(@Param('id') id: string) {
    return this.customerService.detail(this.companyId(), Number(id));
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('CUSTOMER_UPDATE')
  @Patch('customers/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customerService.update(this.companyId(), this.userId(), Number(id), dto as Record<string, unknown>);
  }

  /** 逻辑删除保护：有缴费记录的客户禁止删除 */
  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('CUSTOMER_DELETE')
  @Delete('customers/:id')
  delete(@Param('id') id: string) {
    return this.customerService.delete(this.companyId(), Number(id));
  }

  /** 房屋状态机流转（"未交房→已交房"仅由交房缴费事务触发，非法流转拒绝 PMS-3005） */
  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('CUSTOMER_STATUS_TRANSITION')
  @Post('customers/:id/house-status')
  transitionStatus(@Param('id') id: string, @Body() dto: TransitionStatusDto) {
    return this.customerService.transitionStatus(this.companyId(), Number(id), dto.target);
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('CUSTOMER_PLATE_ADD')
  @Post('customers/:id/plates')
  addPlate(@Param('id') id: string, @Body() dto: PlateDto) {
    return this.customerService.addPlate(this.companyId(), Number(id), dto.plateNo);
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('customers/:id/change-logs')
  changeLogs(@Param('id') id: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.customerService.changeLogs(this.companyId(), Number(id), page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined);
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('CUSTOMER_CONFIRM_PROFILE')
  @Post('customers/:id/confirm-profile')
  confirmProfile(@Param('id') id: string) {
    return this.customerService.confirmProfile(this.companyId(), this.userId(), Number(id));
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_PROFILE_UNLOCK)
  @Audit('CUSTOMER_UNLOCK_PROFILE')
  @Post('customers/:id/unlock-profile')
  unlockProfile(@Param('id') id: string) {
    return this.customerService.unlockProfile(this.companyId(), this.userId(), Number(id));
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('CUSTOMER_RESALE')
  @Post('customers/:id/resale')
  resale(@Param('id') id: string, @Body() dto: ResaleDto) {
    return this.customerService.resale(this.companyId(), this.userId(), Number(id), dto);
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('customers/:id/decorate-filings')
  listDecorateFilings(@Param('id') id: string) {
    return this.customerService.listDecorateFilings(this.companyId(), Number(id));
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('DECORATE_FILING_CREATE')
  @Post('customers/:id/decorate-filings')
  createDecorateFiling(@Param('id') id: string, @Body() dto: DecorateFilingDto) {
    return this.customerService.createDecorateFiling(this.companyId(), this.userId(), Number(id), dto);
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_UPDATE)
  @Audit('DECORATE_FILING_CLOSE')
  @Post('customers/:id/decorate-filings/:filingId/close')
  closeDecorateFiling(@Param('id') id: string, @Param('filingId') filingId: string, @Body() dto: CloseDecorateDto) {
    return this.customerService.closeDecorateFiling(this.companyId(), Number(id), Number(filingId), dto.endDate);
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_CREATE)
  @Audit('EXT_KEY_REGISTER')
  @Post('customer-ext-keys')
  registerExtKey(@Body() dto: ExtKeyDto) {
    return this.customerService.registerExtKey(
      this.companyId(),
      dto.keyName,
      dto.displayName,
      dto.valueType ?? 'string',
      dto.required ?? false,
      dto.validationRule,
    );
  }

  @RequirePermissions(PermissionCodes.CUSTOMER_VIEW)
  @Get('customer-ext-keys')
  listExtKeys() {
    return this.customerService.listExtKeys(this.companyId());
  }
}

export { HOUSE_STATUS_LABELS, ErrorCodes };