import { SetMetadata } from '@nestjs/common';

/** 审计元数据：操作类型 */
export const AUDIT_KEY = 'audit_action_type';

export const Audit = (actionType: string) => SetMetadata(AUDIT_KEY, actionType);