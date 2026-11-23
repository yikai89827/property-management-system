import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditLogEntity } from '../../database/entities/auth-entities';

@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogController {
  constructor(
    @InjectRepository(AuditLogEntity) private readonly auditRepo: Repository<AuditLogEntity>,
  ) {}

  /** 审计检索（时间/操作人/操作类型条件）；审计表无 update/delete 接口（防篡改） */
  @RequirePermissions(PermissionCodes.AUDIT_VIEW)
  @Get()
  async list(
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('operatorId') operatorId?: string,
    @Query('actionType') actionType?: string,
  ) {
    const qb = this.auditRepo.createQueryBuilder('a').orderBy('a.createdAt', 'DESC').limit(200);
    if (startTime) qb.andWhere('a.createdAt >= :startTime', { startTime });
    if (endTime) qb.andWhere('a.createdAt <= :endTime', { endTime });
    if (operatorId) qb.andWhere('a.operatorId = :operatorId', { operatorId: Number(operatorId) });
    if (actionType) qb.andWhere('a.actionType = :actionType', { actionType });
    const [list, total] = await Promise.all([qb.getMany(), qb.getCount()]);
    return { list, total };
  }
}