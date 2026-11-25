import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CustomerChangeLogEntity,
  CustomerEntity,
  DecorateFilingEntity,
  OwnershipHistoryEntity,
  PersonEntity,
  ProjectEntity,
  VehiclePlateEntity,
} from '../../database/entities/org-entities';
import { ExtKeyRegistryEntity } from '../../database/entities/auth-entities';
import { PropertyFeeLedgerEntity, ReceiptOrderEntity } from '../../database/entities/charging-entities';
import { FeeParameterModule } from '../fee-parameter/fee-parameter.module';
import { CustomerService } from './customer.service';
import { CustomerController } from './customer.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerEntity,
      PersonEntity,
      ProjectEntity,
      VehiclePlateEntity,
      CustomerChangeLogEntity,
      OwnershipHistoryEntity,
      DecorateFilingEntity,
      ExtKeyRegistryEntity,
      ReceiptOrderEntity,
      PropertyFeeLedgerEntity,
    ]),
    FeeParameterModule,
  ],
  providers: [CustomerService],
  controllers: [CustomerController],
  exports: [CustomerService],
})
export class CustomerModule {}