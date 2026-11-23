import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StatisticsService } from './statistics.service';

function parseProjectIds(projectIds?: string): number[] | undefined {
  if (!projectIds) return undefined;
  const ids = projectIds.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}

@ApiTags('statistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  private companyId(): number {
    return TenantContext.getCompanyId()!;
  }

  /** 月度统计（应收/实收/优惠/押金） */
  @RequirePermissions(PermissionCodes.STATISTIC_MONTHLY_VIEW)
  @Get('monthly')
  monthly(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.statisticsService.monthly(this.companyId(), startTime, endTime, parseProjectIds(projectIds));
  }

  /** 年度统计（各月汇总+合计） */
  @RequirePermissions(PermissionCodes.STATISTIC_YEARLY_VIEW)
  @Get('yearly')
  yearly(@Query('year') year?: string, @Query('projectIds') projectIds?: string) {
    return this.statisticsService.yearly(this.companyId(), year ?? String(new Date().getFullYear()), parseProjectIds(projectIds));
  }

  /** 分类统计（按收费类别） */
  @RequirePermissions(PermissionCodes.STATISTIC_CATEGORY_VIEW)
  @Get('category')
  category(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.statisticsService.category(this.companyId(), startTime, endTime, parseProjectIds(projectIds));
  }

  /** 欠费统计 */
  @RequirePermissions(PermissionCodes.STATISTIC_ARREARS_VIEW)
  @Get('arrears')
  arrears(@Query('projectIds') projectIds?: string) {
    return this.statisticsService.arrears(this.companyId(), parseProjectIds(projectIds));
  }

  @RequirePermissions(PermissionCodes.STATISTIC_RECEIVABLE_VIEW)
  @Get('receivable')
  receivable(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.statisticsService.special(this.companyId(), 'receivable', startTime, endTime, parseProjectIds(projectIds));
  }

  @RequirePermissions(PermissionCodes.STATISTIC_RECEIVED_VIEW)
  @Get('received')
  received(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.statisticsService.special(this.companyId(), 'received', startTime, endTime, parseProjectIds(projectIds));
  }

  @RequirePermissions(PermissionCodes.STATISTIC_DISCOUNT_VIEW)
  @Get('discount')
  discount(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.statisticsService.special(this.companyId(), 'discount', startTime, endTime, parseProjectIds(projectIds));
  }

  /** 押金统计 */
  @RequirePermissions(PermissionCodes.STATISTIC_DEPOSIT_VIEW)
  @Get('deposit')
  deposit(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('projectIds') projectIds?: string,
  ) {
    return this.statisticsService.special(this.companyId(), 'deposit', startTime, endTime, parseProjectIds(projectIds));
  }
}