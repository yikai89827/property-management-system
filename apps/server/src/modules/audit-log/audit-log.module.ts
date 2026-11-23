import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from '../../database/entities/auth-entities';
import { AuditLogController } from './audit-log.controller';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity])],
  controllers: [AuditLogController],
  providers: [AuditInterceptor],
  exports: [AuditInterceptor],
})
export class AuditLogModule {}