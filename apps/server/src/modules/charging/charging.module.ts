import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FeeCategoryEntity,
  PaymentMethodEntity,
  PaymentRecordEntity,
  PropertyFeeLedgerEntity,
  ReceiptOrderEntity,
  ReceiptOrderItemEntity,
  SequenceDailyEntity,
} from '../../database/entities/charging-entities';
import { CustomerEntity, ProjectEntity } from '../../database/entities/org-entities';
import { ChargingService } from './charging.service';
import { ChargingController } from './charging.controller';
import { SequenceService } from './sequence.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReceiptOrderEntity,
      ReceiptOrderItemEntity,
      PropertyFeeLedgerEntity,
      PaymentRecordEntity,
      PaymentMethodEntity,
      FeeCategoryEntity,
      SequenceDailyEntity,
      CustomerEntity,
      ProjectEntity,
    ]),
  ],
  providers: [ChargingService, SequenceService],
  controllers: [ChargingController],
  exports: [ChargingService, SequenceService],
})
export class ChargingModule {}