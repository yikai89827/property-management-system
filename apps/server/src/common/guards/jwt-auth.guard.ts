import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErrorCodes } from '@pms/shared';
import { BusinessException } from '../exceptions/business.exception';
import { TenantContext } from '../tenant/tenant-context';
import { IS_PUBLIC_KEY } from './owner-scope.guard';

declare module 'express' {
  interface Request {
    claims?: import('../../modules/auth/auth.service').LoginClaims;
  }
}

/** JWT 守卫：TenantMiddleware 已完成验签与上下文注入，此处仅校验存在性；@Public() 放行 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.claims || !TenantContext.get()) {
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, undefined, 401);
    }
    return true;
  }
}
