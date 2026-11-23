import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErrorCodes } from '@pms/shared';
import { BusinessException } from '../exceptions/business.exception';

export const IS_PUBLIC_KEY = 'is_public_route';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * 业主范围守卫：aud=owner 短期令牌仅可访问 /owner/* 接口；
 * admin/staff 令牌访问 owner 接口被拒；@Public() 标记的接口跳过。
 */
@Injectable()
export class OwnerScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.get<boolean>(IS_PUBLIC_KEY, context.getHandler());
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (request.claims?.aud !== 'owner') {
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, '请先完成业主身份验证', 401);
    }
    return true;
  }
}