import { SetMetadata } from '@nestjs/common';

/** 接口声明所需权限点（Swagger 元数据 x-required-permissions 同源） */
export const PERMISSIONS_KEY = 'required_permissions';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);