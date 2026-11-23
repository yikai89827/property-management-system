import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { ErrorCodes } from '@pms/shared';
import { BusinessException } from '../exceptions/business.exception';
import { TenantContext, TenantPayload } from './tenant-context';
import { LoginClaims } from '../../modules/auth/auth.service';
import { AuthService } from '../../modules/auth/auth.service';

/**
 * 租户上下文中间件：请求入口验签 JWT、实时校验账号状态，
 * 并以 AsyncLocalStorage.run 包裹 next()，使后续 guard/service/repository
 * 均可通过 TenantContext 读取 companyId/userId。
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    // 公开路径（登录/健康检查/文档）无令牌直接放行
    const url = req.originalUrl ?? req.url;
    const publicPath = [
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/health',
      '/api/docs',
      '/api/v1/owner/auth/verify',
    ];
    const isPublic = publicPath.some((p) => url.startsWith(p));
    if (!header?.startsWith('Bearer ')) {
      if (isPublic) {
        return next();
      }
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, undefined, 401);
    }
    const token = header.slice(7);
    let claims: LoginClaims;
    try {
      claims = this.jwtService.verify(token);
    } catch {
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, undefined, 401);
    }

    let payload: TenantPayload;
    if (claims.aud === 'owner') {
      // 业主短期令牌：仅可访问 /owner/* 接口
      if (!url.includes('/api/v1/owner/')) {
        throw new BusinessException(ErrorCodes.UNAUTHORIZED, '令牌类型不允许访问该接口', 401);
      }
      payload = {
        companyId: claims.companyId,
        isOwner: true,
        customerId: claims.customerId,
        projectScopes: [],
        allProjectsScope: false,
      };
    } else {
      // 员工令牌：实时查库校验 status=active（停用返回 PMS-6001，登录态实时失效）
      const user = await this.authService.assertUserActive(claims.sub);
      payload = {
        companyId: user.companyId,
        userId: user.id,
        isOwner: false,
        projectScopes: [],
        allProjectsScope: user.allProjectsScope,
      };
    }

    (req as unknown as { claims?: LoginClaims }).claims = claims;
    TenantContext.run(payload, () => next());
  }
}