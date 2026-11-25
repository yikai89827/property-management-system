import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { FeeParameterCode, PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Audit } from '../../common/interceptors/audit.decorator';
import { ProjectService } from './project.service';

class CreateProjectDto {
  @IsString()
  @MaxLength(50)
  name!: string;

  @IsNumber()
  landArea!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;
}

class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsNumber()
  landArea?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

class UpdateProjectFeeDto {
  @IsEnum(FeeParameterCode)
  itemCode!: FeeParameterCode;

  @IsNumber()
  value!: number;
}

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @RequirePermissions(PermissionCodes.PROJECT_VIEW)
  @Get()
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.projectService.list(TenantContext.getCompanyId()!, Number(page ?? 1), Number(pageSize ?? 20));
  }

  /** 全局项目切换器用的轻量选项（须放在 :id 之前） */
  @RequirePermissions(PermissionCodes.PROJECT_VIEW)
  @Get('options/all')
  options() {
    return this.projectService.options(TenantContext.getCompanyId()!);
  }

  @RequirePermissions(PermissionCodes.PROJECT_CREATE)
  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectService.create(TenantContext.getCompanyId()!, dto.name, dto.landArea, dto.address);
  }

  @RequirePermissions(PermissionCodes.PROJECT_VIEW)
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.projectService.detail(TenantContext.getCompanyId()!, Number(id));
  }

  /** 项目费用参数（物业费单价等，项目级覆盖公司默认） */
  @RequirePermissions(PermissionCodes.PROJECT_VIEW)
  @Get(':id/fee-parameters')
  feeParameters(@Param('id') id: string) {
    return this.projectService.feeParameters(TenantContext.getCompanyId()!, Number(id));
  }

  /** 设定项目费用参数（版本化，仅影响新生成缴费单） */
  @RequirePermissions(PermissionCodes.PROJECT_UPDATE)
  @Audit('PROJECT_FEE_PARAMETER_UPDATE')
  @Put(':id/fee-parameters')
  updateFeeParameter(@Param('id') id: string, @Body() dto: UpdateProjectFeeDto) {
    return this.projectService.updateFeeParameter(
      TenantContext.getCompanyId()!,
      TenantContext.getUserId()!,
      Number(id),
      dto.itemCode,
      dto.value,
    );
  }

  @RequirePermissions(PermissionCodes.PROJECT_UPDATE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectService.update(TenantContext.getCompanyId()!, Number(id), dto);
  }
}
