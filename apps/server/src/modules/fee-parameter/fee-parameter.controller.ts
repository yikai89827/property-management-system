import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional } from 'class-validator';
import { FeeParameterCode, PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Audit } from '../../common/interceptors/audit.decorator';
import { FeeParameterService } from './fee-parameter.service';

class UpdateFeeParameterDto {
  @IsEnum(FeeParameterCode)
  itemCode!: FeeParameterCode;

  /** 传入则为项目级覆盖；不传为公司默认 */
  @IsOptional()
  @IsNumber()
  projectId?: number;

  @IsNumber()
  value!: number;
}

@ApiTags('fee-parameters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('fee-parameters')
export class FeeParameterController {
  constructor(private readonly feeParameterService: FeeParameterService) {}

  /** 当前生效参数（项目级覆盖公司级）；detail=1 时带上来源 */
  @RequirePermissions(PermissionCodes.FEE_PARAMETER_MANAGE)
  @Get()
  current(@Query('projectId') projectId?: string, @Query('detail') detail?: string) {
    const companyId = TenantContext.getCompanyId()!;
    const pid = projectId ? Number(projectId) : undefined;
    if (detail === '1' || detail === 'true') {
      return this.feeParameterService.currentWithSource(companyId, pid);
    }
    return this.feeParameterService.current(companyId, pid);
  }

  /** 参数调整：新增生效版本（仅对新生成缴费单生效，历史单不回溯） */
  @RequirePermissions(PermissionCodes.FEE_PARAMETER_MANAGE)
  @Audit('FEE_PARAMETER_UPDATE')
  @Put()
  update(@Body() dto: UpdateFeeParameterDto) {
    return this.feeParameterService.update(TenantContext.getCompanyId()!, TenantContext.getUserId()!, dto);
  }

  @RequirePermissions(PermissionCodes.FEE_PARAMETER_MANAGE)
  @Get('history')
  history(@Query('projectId') projectId?: string) {
    return this.feeParameterService.history(TenantContext.getCompanyId()!, projectId ? Number(projectId) : undefined);
  }
}