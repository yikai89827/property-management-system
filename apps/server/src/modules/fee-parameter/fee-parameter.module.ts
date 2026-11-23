import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FeeCategoryEntity,
  FeeParameterEntity,
  PaymentMethodEntity,
} from '../../database/entities/charging-entities';
import { FeeParameterService } from './fee-parameter.service';
import { FeeParameterController } from './fee-parameter.controller';
import { DictController } from './dict.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FeeParameterEntity, FeeCategoryEntity, PaymentMethodEntity])],
  providers: [FeeParameterService],
  controllers: [FeeParameterController, DictController],
  exports: [FeeParameterService],
})
export class FeeParameterModule {}