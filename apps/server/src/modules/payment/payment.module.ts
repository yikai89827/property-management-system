import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentRecordEntity, PropertyFeeLedgerEntity, ReceiptOrderEntity } from '../../database/entities/charging-entities';
import { PaymentService } from './payment.service';
import { PaymentCallbackController, PaymentController } from './payment.controller';
import { OfflineRecordProvider, PaymentChannelRegistry } from './payment.service';
import { NotificationModule } from '../notification/notification.module';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PaymentRecordEntity, PropertyFeeLedgerEntity, ReceiptOrderEntity]), NotificationModule],
  providers: [PaymentService, OfflineRecordProvider, PaymentChannelRegistry],
  controllers: [PaymentController, PaymentCallbackController],
  exports: [PaymentService, PaymentChannelRegistry],
})
export class PaymentModule {}