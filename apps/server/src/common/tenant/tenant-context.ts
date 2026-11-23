import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantPayload {
  companyId: number;
  userId?: number;
  isOwner?: boolean;
  customerId?: number;
  projectScopes: number[];
  allProjectsScope: boolean;
}

/** 请求级租户上下文（AsyncLocalStorage，业务代码无感知传递 companyId/userId） */
const storage = new AsyncLocalStorage<TenantPayload>();

export const TenantContext = {
  run<T>(payload: TenantPayload, callback: () => T): T {
    return storage.run(payload, callback);
  },
  get(): TenantPayload | undefined {
    return storage.getStore();
  },
  getCompanyId(): number | undefined {
    return storage.getStore()?.companyId;
  },
  getUserId(): number | undefined {
    return storage.getStore()?.userId;
  },
  getUserIdSafe(): number | undefined {
    return storage.getStore()?.userId;
  },
};