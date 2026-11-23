import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorCodes } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { UserEntity } from '../../database/entities/auth-entities';

export interface LoginClaims {
  sub: number;
  companyId: number;
  username: string;
  realName: string;
  aud: 'staff' | 'owner';
  customerId?: number;
}

/** 密码哈希格式：sha256hex:salt */
export function verifyPassword(password: string, stored: string): boolean {
  const [hash, salt] = stored.split(':');
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(`${salt ?? 'pms-salt'}:${password}`).digest('hex') === hash;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
  ) {}

  /** 登录：签发 Access/Refresh 双令牌 */
  async login(username: string, password: string) {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new BusinessException(ErrorCodes.VALIDATION_FAILED, '账号或密码错误', 401);
    }
    if (user.status !== 'active') {
      throw new BusinessException(ErrorCodes.ACCOUNT_DISABLED, undefined, 401);
    }
    return this.issueStaffTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: LoginClaims & { typ?: string };
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, '刷新令牌无效', 401);
    }
    if (payload.typ !== 'refresh') {
      throw new BusinessException(ErrorCodes.UNAUTHORIZED, '刷新令牌无效', 401);
    }
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') {
      throw new BusinessException(ErrorCodes.ACCOUNT_DISABLED, undefined, 401);
    }
    return { accessToken: this.jwtService.sign(this.staffClaims(user), { expiresIn: '2h' }) };
  }

  /** 登出（无状态令牌：前端删除即可，预留黑名单扩展点） */
  async logout(): Promise<void> {
    return;
  }

  issueStaffTokens(user: UserEntity) {
    const claims = this.staffClaims(user);
    return {
      accessToken: this.jwtService.sign(claims, { expiresIn: '2h' }),
      refreshToken: this.jwtService.sign({ ...claims, typ: 'refresh' }, { expiresIn: '7d' }),
    };
  }

  staffClaims(user: UserEntity): LoginClaims {
    return { sub: user.id, companyId: user.companyId, username: user.username, realName: user.realName, aud: 'staff' };
  }

  /** 业主端短期令牌（2h，aud=owner，绑定 customer_id） */
  issueOwnerToken(companyId: number, customerId: number, ttlSeconds: number): string {
    const claims: LoginClaims = {
      sub: 0,
      companyId,
      username: `owner:${customerId}`,
      realName: '业主',
      aud: 'owner',
      customerId,
    };
    return this.jwtService.sign(claims, { expiresIn: ttlSeconds });
  }

  /** 停用账号实时查库校验（JwtAuthGuard 每请求执行，登录态实时失效） */
  async assertUserActive(userId: number): Promise<UserEntity> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.status !== 'active') {
      throw new BusinessException(ErrorCodes.ACCOUNT_DISABLED, undefined, 401);
    }
    return user;
  }
}