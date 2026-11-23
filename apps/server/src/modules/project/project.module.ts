import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerEntity, ProjectEntity } from '../../database/entities/org-entities';
import { ReceiptOrderEntity } from '../../database/entities/charging-entities';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ReceiptOrderEntity, CustomerEntity])],
  providers: [ProjectService],
  controllers: [ProjectController],
  exports: [ProjectService],
})
export class ProjectModule {}