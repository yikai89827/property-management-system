import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  RoleEntity,
  UserEntity,
  UserPermissionOverrideEntity,
  UserProjectScopeEntity,
  UserRoleEntity,
} from '../../database/entities/auth-entities';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RoleEntity, UserRoleEntity, UserPermissionOverrideEntity, UserProjectScopeEntity]),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}