import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { NotificationOutboxStatus, NotificationType } from '@pms/shared';
import { NotificationOutboxEntity } from '../../database/entities/phase2-entities';

/** 通知渠道接口（二期公众号实现注册后可零业务改动投递） */
export interface NotificationChannel {
  readonly channelName: string;
  send(customerId: number, title: string, content: string): Promise<void>;
}

/** 一期 LoggingChannel：仅记录日志 */
@Injectable()
export class LoggingChannel implements NotificationChannel {
  readonly channelName = 'logging';

  async send(customerId: number, title: string, content: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[notification] customer=${customerId} title=${title} content=${content}`);
  }
}

/**
 * 通知服务：通知写 notification_outbox（类型枚举一期固化），
 * 缴费确认/驳回触发 PAYMENT_RESULT 通知；支持事务内写入。
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(NotificationOutboxEntity) private readonly outboxRepo: Repository<NotificationOutboxEntity>,
    private readonly loggingChannel: LoggingChannel,
  ) {}

  /** 事务内写入 outbox（manager 为事务执行器） */
  async push(
    manager: EntityManager,
    companyId: number,
    customerId: number,
    type: NotificationType,
    title: string,
    content: string,
    bizRef?: string,
  ): Promise<NotificationOutboxEntity> {
    const repo = manager.getRepository(NotificationOutboxEntity);
    return repo.save(
      repo.create({
        companyId,
        customerId,
        type,
        title,
        content,
        bizRef,
        status: NotificationOutboxStatus.PENDING,
      }),
    );
  }

  /** 投递 pending 通知（一期 LoggingChannel；二期注册公众号渠道后调用同一入口） */
  async dispatchPending(companyId: number, limit = 50): Promise<number> {
    const pending = await this.outboxRepo.find({
      where: { companyId, status: NotificationOutboxStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    let sent = 0;
    for (const item of pending) {
      try {
        await this.loggingChannel.send(item.customerId, item.title, item.content);
        item.status = NotificationOutboxStatus.SENT;
        await this.outboxRepo.save(item);
        sent++;
      } catch {
        item.status = NotificationOutboxStatus.FAILED;
        await this.outboxRepo.save(item);
      }
    }
    return sent;
  }
}