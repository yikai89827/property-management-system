import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ErrorCodes } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SequenceDailyEntity } from '../../database/entities/charging-entities';

/**
 * 单据编号发号器：事务内 INSERT OR UPDATE last_no + 1；
 * 编号格式 {前缀}{YYYYMMDD}{6位日序列}；UNIQUE(order_no) 唯一索引兜底；
 * 编号一经写入不提供任何修改路径。
 */
@Injectable()
export class SequenceService {
  constructor(
    @InjectRepository(SequenceDailyEntity) private readonly seqRepo: Repository<SequenceDailyEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** 事务内发号（在传入的事务执行器上操作，保证与业务同事务） */
  async nextOrderNo(
    manager: EntityManager,
    companyId: number,
    prefix: string,
    seqDate: string,
  ): Promise<string> {
    const repo = manager.getRepository(SequenceDailyEntity);
    const existing = await repo.findOne({ where: { companyId, companyPrefix: prefix, seqDate } });
    if (existing) {
      existing.lastNo = existing.lastNo + 1;
      await repo.save(existing);
      return this.format(prefix, seqDate, existing.lastNo);
    }
    await repo.insert({ companyId, companyPrefix: prefix, seqDate, lastNo: 1 });
    return this.format(prefix, seqDate, 1);
  }

  /** 非事务环境发号（自动开短事务，供测试） */
  async nextOrderNoStandalone(companyId: number, prefix: string, seqDate: string): Promise<string> {
    return this.dataSource.transaction(async (manager) => this.nextOrderNo(manager, companyId, prefix, seqDate));
  }

  private format(prefix: string, seqDate: string, lastNo: number): string {
    const seq = String(lastNo).padStart(6, '0');
    return `${prefix}${seqDate.replace(/-/g, '')}${seq}`;
  }
}

/** 并发兜底校验辅助：构造重复错误 */
export function duplicateOrderNoError(): BusinessException {
  return new BusinessException(ErrorCodes.INTERNAL_ERROR, '单据编号冲突，请重试', 500);
}