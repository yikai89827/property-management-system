import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';
import { PermissionCodes } from '@pms/shared';
import { RequirePermissions } from '../../common/guards/require-permissions.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireCompanyAdmin } from '../../common/guards/require-company-admin.decorator';
import { Audit } from '../../common/interceptors/audit.decorator';
import { UserService } from './user.service';

class CreateUserDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  realName!: string;

  @IsArray()
  roleCodes!: string[];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  realName?: string;

  @IsOptional()
  @IsString()
  status?: string;

  /** 留空表示不改密码；填写则至少 6 位 */
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsArray()
  roleCodes?: string[];
}

class CreateRoleDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsArray()
  permissionIds!: number[];
}

class SetRolePermissionsDto {
  @IsArray()
  permissionIds!: number[];
}

class UserPermissionsDto {
  @IsArray()
  overrides!: { permissionCode: string; overrideType: 'allow' | 'deny' }[];
}

class ProjectScopesDto {
  @IsBoolean()
  allProjectsScope!: boolean;

  @IsArray()
  projectIds!: number[];
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  private companyId(): number {
    return TenantContext.getCompanyId()!;
  }

  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Get('users')
  listUsers() {
    return this.userService.listUsers(this.companyId());
  }

  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Audit('USER_CREATE')
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(this.companyId(), dto.username, dto.password, dto.realName, dto.roleCodes);
  }

  /** 停用即离职生效路径（记录 disabled_at，登录态实时失效） */
  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Audit('USER_UPDATE')
  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.updateUser(this.companyId(), Number(id), dto);
  }

  /** 删除从未登录过的账号 */
  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Audit('USER_DELETE')
  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.userService.deleteUser(this.companyId(), Number(id), TenantContext.getUserId()!);
  }

  @RequirePermissions(PermissionCodes.ROLE_MANAGE)
  @RequireCompanyAdmin()
  @Get('roles')
  listRoles() {
    return this.userService.listRoles(this.companyId());
  }

  @RequirePermissions(PermissionCodes.ROLE_MANAGE)
  @RequireCompanyAdmin()
  @Audit('ROLE_CREATE')
  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.userService.createRole(this.companyId(), dto.code, dto.name, dto.permissionIds);
  }

  @RequirePermissions(PermissionCodes.ROLE_MANAGE)
  @RequireCompanyAdmin()
  @Audit('ROLE_UPDATE')
  @Put('roles/:id/permissions')
  setRolePermissions(@Param('id') id: string, @Body() dto: SetRolePermissionsDto) {
    return this.userService.setRolePermissions(this.companyId(), Number(id), dto.permissionIds);
  }

  @RequirePermissions(PermissionCodes.ROLE_MANAGE)
  @RequireCompanyAdmin()
  @Audit('ROLE_DELETE')
  @Delete('roles/:id')
  deleteRole(@Param('id') id: string) {
    return this.userService.deleteRole(this.companyId(), Number(id));
  }

  @RequirePermissions(PermissionCodes.ROLE_MANAGE)
  @RequireCompanyAdmin()
  @Get('permissions')
  listPermissions() {
    return this.userService['permissionService'].listPermissions();
  }

  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Get('users/:id/permissions')
  getUserPermissions(@Param('id') id: string) {
    return this.userService.getUserPermissions(this.companyId(), Number(id));
  }

  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Audit('USER_PERMISSION_UPDATE')
  @Put('users/:id/permissions')
  putUserPermissions(@Param('id') id: string, @Body() dto: UserPermissionsDto) {
    return this.userService.putUserPermissions(this.companyId(), Number(id), dto.overrides);
  }

  @RequirePermissions(PermissionCodes.USER_MANAGE)
  @RequireCompanyAdmin()
  @Audit('USER_PROJECT_SCOPE_UPDATE')
  @Put('users/:id/project-scopes')
  putProjectScopes(@Param('id') id: string, @Body() dto: ProjectScopesDto) {
    return this.userService.putProjectScopes(this.companyId(), Number(id), dto.allProjectsScope, dto.projectIds);
  }
}