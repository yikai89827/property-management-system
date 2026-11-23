import { Module } from '@nestjs/common';
import { HrController, ValueAddedServiceController, WorkOrderController } from './phase2.controller';

/** 二期框架模块骨架（任务 10.1）：占位接口 + 二期标识；表结构已建（phase2-entities） */
@Module({
  controllers: [WorkOrderController, HrController, ValueAddedServiceController],
})
export class WorkOrderModule {}