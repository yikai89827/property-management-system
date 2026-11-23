import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PropertyFeeLedgerEntity } from '../../database/entities/charging-entities';
import { FeeCalculationService } from './fee-calculation.service';
import { FeeCalculationController } from './fee-calculation.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PropertyFeeLedgerEntity])],
  providers: [FeeCalculationService],
  controllers: [FeeCalculationController],
  exports: [FeeCalculationService],
})
export class FeeCalculationModule {}