import { SetMetadata } from '@nestjs/common';

/** 仅公司管理员可调用（非管理员拒绝并记越权审计） */
export const COMPANY_ADMIN_KEY = 'require_company_admin';

export const RequireCompanyAdmin = () => SetMetadata(COMPANY_ADMIN_KEY, true);