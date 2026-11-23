import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationOutboxEntity } from '../../database/entities/phase2-entities';
import { LoggingChannel, NotificationService } from './notification.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([NotificationOutboxEntity])],
  providers: [LoggingChannel, NotificationService],
  exports: [NotificationService, LoggingChannel],
})
export class NotificationModule {}