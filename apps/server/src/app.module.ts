import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { SeedService } from './database/seeds/seed.service';
import { CommonModule } from './common/common.module';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { HealthController } from './modules/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ProjectModule } from './modules/project/project.module';
import { CustomerModule } from './modules/customer/customer.module';
import { FeeParameterModule } from './modules/fee-parameter/fee-parameter.module';
import { FeeCalculationModule } from './modules/fee-calculation/fee-calculation.module';
import { ChargingModule } from './modules/charging/charging.module';
import { PaymentModule } from './modules/payment/payment.module';
import { OwnerModule } from './modules/owner/owner.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { NotificationModule } from './modules/notification/notification.module';
import { WorkOrderModule } from './modules/phase2/work-order.module';
import { HrModule } from './modules/phase2/hr.module';
import { ValueAddedServiceModule } from './modules/phase2/value-added-service.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['.env'] }),
    CommonModule,
    DatabaseModule,
    AuthModule,
    UserModule,
    AuditLogModule,
    ProjectModule,
    CustomerModule,
    FeeParameterModule,
    FeeCalculationModule,
    ChargingModule,
    PaymentModule,
    OwnerModule,
    StatisticsModule,
    NotificationModule,
    WorkOrderModule,
    HrModule,
    ValueAddedServiceModule,
  ],
  controllers: [HealthController],
  providers: [
    SeedService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}