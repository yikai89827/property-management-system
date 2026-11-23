import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerEntity, PersonEntity, ProjectEntity, VehiclePlateEntity } from '../../database/entities/org-entities';
import {
  OwnerVerifyAttemptEntity,
  PaymentMethodEntity,
  PaymentRecordEntity,
  PropertyFeeLedgerEntity,
  ReceiptOrderEntity,
  ReceiptOrderItemEntity,
  SequenceDailyEntity,
} from '../../database/entities/charging-entities';
import { OwnerService } from './owner.service';
import { OwnerController } from './owner.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerEntity,
      PersonEntity,
      ProjectEntity,
      VehiclePlateEntity,
      OwnerVerifyAttemptEntity,
      PaymentMethodEntity,
      PaymentRecordEntity,
      PropertyFeeLedgerEntity,
      ReceiptOrderEntity,
      ReceiptOrderItemEntity,
      SequenceDailyEntity,
    ]),
  ],
  providers: [OwnerService],
  controllers: [OwnerController],
  exports: [OwnerService],
})
export class OwnerModule {}