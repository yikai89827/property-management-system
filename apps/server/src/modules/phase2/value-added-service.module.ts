import { Module } from '@nestjs/common';
import { ValueAddedServiceController } from './phase2.controller';

@Module({
  controllers: [ValueAddedServiceController],
})
export class ValueAddedServiceModule {}