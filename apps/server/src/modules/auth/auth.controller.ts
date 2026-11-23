import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { PermissionService } from '../permission/permission.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/guards/owner-scope.guard';
import { TenantContext } from '../../common/tenant/tenant-context';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/auth-entities';
import { CompanyEntity } from '../../database/entities/org-entities';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(CompanyEntity) private readonly companyRepo: Repository<CompanyEntity>,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  logout() {
    return this.authService.logout();
  }

  /** 当前登录用户信息与权限清单（登录后拉取，前端动态路由依据） */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me() {
    const companyId = TenantContext.getCompanyId()!;
    const userId = TenantContext.getUserId()!;
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    const resolved = await this.permissionService.resolveForUser(companyId, userId);
    return {
      id: userId,
      username: user?.username,
      realName: user?.realName,
      companyName: company?.name,
      permissions: [...resolved.permissions],
      allProjectsScope: resolved.allProjectsScope,
      projectScopes: resolved.projectScopes,
    };
  }
}