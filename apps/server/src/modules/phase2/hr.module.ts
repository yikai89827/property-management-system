import { Module } from '@nestjs/common';
import { HrController } from './phase2.controller';

@Module({
  controllers: [HrController],
})
export class HrModule {}