import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RoleEntity, UserEntity, UserRoleEntity } from '../../database/entities/auth-entities';
import { CompanyEntity } from '../../database/entities/org-entities';
import { PermissionService } from '../permission/permission.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      signOptions: { expiresIn: '2h' },
    }),
    TypeOrmModule.forFeature([UserEntity, RoleEntity, UserRoleEntity, CompanyEntity]),
  ],
  providers: [AuthService, PermissionService, JwtAuthGuard, PermissionGuard],
  controllers: [AuthController],
  exports: [AuthService, PermissionService],
})
export class AuthModule {}