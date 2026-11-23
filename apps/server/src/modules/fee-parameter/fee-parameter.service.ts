import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCodes, FeeParameterCode } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TenantService } from '../../common/tenant/tenant.service';
import { FeeParameterEntity } from '../../database/entities/charging-entities';

/**
 * 费用参数服务（版本化）：
 * - 当前生效值 = 项目级最新版本覆盖公司级最新版本；
 * - PUT 新增生效版本，历史版本保留（不回溯历史收款单）。
 */
@Injectable()
export class FeeParameterService {
  constructor(
    @InjectRepository(FeeParameterEntity) private readonly paramRepo: Repository<FeeParameterEntity>,
    private readonly tenantService: TenantService,
  ) {}

  /** 当前生效参数（项目级覆盖公司级） */
  async current(companyId: number, projectId?: number): Promise<Record<FeeParameterCode, number>> {
    const params = {} as Record<FeeParameterCode, number>;
    for (const code of Object.values(FeeParameterCode)) {
      params[code] = await this.resolveOne(companyId, code, projectId);
    }
    return params;
  }

  async resolveOne(companyId: number, code: FeeParameterCode, projectId?: number): Promise<number> {
    if (projectId) {
      const projectVersion = await this.latest(companyId, projectId, code);
      if (projectVersion) return projectVersion.value;
    }
    const companyVersion = await this.latest(companyId, undefined, code);
    if (!companyVersion) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, `费用参数 ${code} 未配置`);
    }
    return companyVersion.value;
  }

  private async latest(companyId: number, projectId: number | undefined, code: FeeParameterCode) {
    const qb = this.paramRepo
      .createQueryBuilder('p')
      .where('p.companyId = :companyId', { companyId })
      .andWhere('p.itemCode = :code', { code })
      .orderBy('p.effectiveAt', 'DESC')
      .limit(1);
    if (projectId) {
      qb.andWhere('p.projectId = :projectId', { projectId });
    } else {
      qb.andWhere('p.projectId IS NULL');
    }
    return qb.getOne();
  }

  /** 参数调整：新增生效版本（历史版本保留，写操作人与审计） */
  async update(companyId: number, userId: number, input: { itemCode: FeeParameterCode; projectId?: number; value: number }) {
    if (!Number.isInteger(input.value) || input.value <= 0) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '参数值必须为正整数（分/百分位口径）');
    }
    return this.paramRepo.save(
      this.paramRepo.create({
        companyId,
        projectId: input.projectId,
        itemCode: input.itemCode,
        value: input.value,
        effectiveAt: new Date().toISOString(),
        operatorId: userId,
      }),
    );
  }

  /** 参数变更历史 */
  async history(companyId: number, projectId?: number) {
    const qb = this.paramRepo
      .createQueryBuilder('p')
      .where('p.companyId = :companyId', { companyId })
      .orderBy('p.effectiveAt', 'DESC')
      .limit(200);
    if (projectId) qb.andWhere('p.projectId = :projectId', { projectId });
    else qb.andWhere('p.projectId IS NULL');
    return qb.getMany();
  }

  /** 便捷方法：公司级默认 + 项目覆盖（供引擎） */
  async resolveForEngine(companyId: number, projectId?: number) {
    const userId = this.tenantService.requireUserId();
    return {
      companyId,
      userId,
      params: await this.current(companyId, projectId),
    };
  }
}