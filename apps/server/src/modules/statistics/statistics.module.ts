import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyFeeLedgerEntity, ReceiptOrderEntity, ReceiptOrderItemEntity } from '../../database/entities/charging-entities';
import { CustomerEntity, ProjectEntity } from '../../database/entities/org-entities';
import { StatisticsService } from './statistics.service';
import { StatisticsController } from './statistics.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ReceiptOrderEntity, ReceiptOrderItemEntity, PropertyFeeLedgerEntity, CustomerEntity, ProjectEntity])],
  providers: [StatisticsService],
  controllers: [StatisticsController],
  exports: [StatisticsService],
})
export class StatisticsModule {}