import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import {
  BuiltInRoles,
  PermissionType,
  FEE_CATEGORY_SEEDS,
  FEE_PARAMETER_LABELS,
  FeeParameterCode,
  PAYMENT_METHOD_SEEDS,
  PERMISSION_GROUPS,
} from '@pms/shared';
import { CompanyEntity, ProjectEntity } from '../entities/org-entities';
import { FeeCategoryEntity, FeeParameterEntity, PaymentMethodEntity } from '../entities/charging-entities';
import { PermissionEntity, RoleEntity, UserEntity } from '../entities/auth-entities';
import { CustomerService } from '../../modules/customer/customer.service';

/** 简单密码哈希（sha256 + 盐） */
export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? 'pms-salt';
  return createHash('sha256').update(`${s}:${password}`).digest('hex') + `:${s}`;
}

/**
 * 种子数据幂等初始化：
 * 公司 / 内置角色 / 权限点 / 费用类别 / 收款方式 / 费用参数默认值 / 初始管理员。
 * 重复启动不产生重复数据。
 */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CompanyEntity) private readonly companyRepo: Repository<CompanyEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(RoleEntity) private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(PermissionEntity) private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(UserEntity) private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(FeeCategoryEntity) private readonly feeCategoryRepo: Repository<FeeCategoryEntity>,
    @InjectRepository(PaymentMethodEntity) private readonly paymentMethodRepo: Repository<PaymentMethodEntity>,
    @InjectRepository(FeeParameterEntity) private readonly feeParameterRepo: Repository<FeeParameterEntity>,
    @Optional() private readonly customerService?: CustomerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  async seed(): Promise<void> {
    // 1. 默认物业公司
    const companyName = process.env.DEFAULT_COMPANY_NAME ?? '株洲桌信物业管理有限责任公司';
    let company = await this.companyRepo.findOne({ where: { name: companyName } });
    if (!company) {
      company = await this.companyRepo.save(this.companyRepo.create({ name: companyName, status: 'active' }));
      this.logger.log(`seed company: ${companyName}`);
    }

    // 2. 权限点（全量 upsert）
    const allPermissions = PERMISSION_GROUPS.flatMap((g) =>
      g.permissions.map((p, i) => ({
        code: p.code,
        name: p.name,
        type: p.type as 'operation' | 'query_scope',
        groupName: g.group,
        sortOrder: i,
      })),
    );
    for (const p of allPermissions) {
      const exists = await this.permissionRepo.findOne({ where: { code: p.code } });
      if (!exists) {
        await this.permissionRepo.save(this.permissionRepo.create({ ...p, type: p.type as PermissionType }));
      }
    }

    // 3. 内置角色（禁删）
    const roleDefs = [
      { code: BuiltInRoles.COMPANY_ADMIN, name: '公司管理员', permissions: allPermissions.map((p) => p.code) },
      {
        code: BuiltInRoles.FINANCE,
        name: '财务',
        // 默认可见：首页/项目/客户/三类缴费/收款单/收款确认/统计；不含权限管理、系统配置
        permissions: [
          'project:view',
          'customer:view',
          'charge:delivery:execute',
          'charge:property:execute',
          'charge:other:execute',
          'charge:receipt:view',
          'payment:record:confirm',
          'statistic:monthly:view',
          'statistic:yearly:view',
          'statistic:category:view',
          'statistic:arrears:view',
          'statistic:receivable:view',
          'statistic:received:view',
          'statistic:discount:view',
          'statistic:deposit:view',
        ],
      },
      {
        code: BuiltInRoles.PROJECT_ADMIN,
        name: '项目管理员',
        permissions: [
          'project:view',
          'project:create',
          'project:update',
          'customer:view',
          'customer:create',
          'customer:update',
          'charge:receipt:view',
          'payment:record:confirm',
        ],
      },
      {
        code: BuiltInRoles.CASHIER,
        name: '收费员',
        permissions: [
          'customer:view',
          'customer:create',
          'customer:update',
          'charge:delivery:execute',
          'charge:property:execute',
          'charge:other:execute',
          'charge:receipt:view',
          'payment:record:confirm',
        ],
      },
      { code: BuiltInRoles.STAFF, name: '普通员工', permissions: ['customer:view'] },
    ];
    const roleMap = new Map<string, RoleEntity>();
    for (const def of roleDefs) {
      let role = await this.roleRepo.findOne({ where: { companyId: company.id, code: def.code } });
      if (!role) {
        role = await this.roleRepo.save(
          this.roleRepo.create({ companyId: company.id, code: def.code, name: def.name, builtIn: true }),
        );
      }
      roleMap.set(def.code, role);
    }

    // 4. 初始管理员账号（admin / admin123，仅首次创建）
    const permissionMap = new Map<string, PermissionEntity>();
    for (const p of await this.permissionRepo.find()) {
      permissionMap.set(p.code, p);
    }

    // 4.0 内置角色补齐缺失权限点（幂等，便于升级后解锁档案等新权限生效）
    {
      const { RolePermissionEntity } = await import('../entities/auth-entities');
      const rpRepo = this.dataSource.getRepository(RolePermissionEntity);
      for (const def of roleDefs) {
        const role = roleMap.get(def.code);
        if (!role) continue;
        for (const code of def.permissions) {
          const perm = permissionMap.get(code);
          if (!perm) continue;
          const exists = await rpRepo.findOne({ where: { companyId: company.id, roleId: role.id, permissionId: perm.id } });
          if (!exists) {
            await rpRepo.save(rpRepo.create({ companyId: company.id, roleId: role.id, permissionId: perm.id }));
          }
        }
      }
    }
    const adminUser = await this.userRepo.findOne({ where: { companyId: company.id, username: 'admin' } });
    if (!adminUser) {
      const admin = await this.userRepo.save(
        this.userRepo.create({
          companyId: company.id,
          username: 'admin',
          passwordHash: hashPassword('admin123'),
          realName: '系统管理员',
          status: 'active',
          allProjectsScope: true,
        }),
      );
      const adminRole = roleMap.get(BuiltInRoles.COMPANY_ADMIN);
      if (adminRole) {
        const { UserRoleEntity, RolePermissionEntity } = await import('../entities/auth-entities');
        await this.dataSource.getRepository(UserRoleEntity).save(
          this.dataSource.getRepository(UserRoleEntity).create({
            companyId: company.id,
            userId: admin.id,
            roleId: adminRole.id,
          }),
        );
        await this.dataSource.getRepository(RolePermissionEntity).save(
          allPermissions.map((p) =>
            this.dataSource.getRepository(RolePermissionEntity).create({
              companyId: company.id,
              roleId: adminRole.id,
              permissionId: permissionMap.get(p.code)!.id,
            }),
          ),
        );
      }
    }

    // 5. 六类费用类别
    for (const cat of FEE_CATEGORY_SEEDS) {
      const exists = await this.feeCategoryRepo.findOne({ where: { companyId: company.id, code: cat.code } });
      if (!exists) {
        await this.feeCategoryRepo.save(this.feeCategoryRepo.create({ companyId: company.id, ...cat }));
      }
    }

    // 6. 五类收款方式
    for (const m of PAYMENT_METHOD_SEEDS) {
      const exists = await this.paymentMethodRepo.findOne({ where: { companyId: company.id, code: m.code } });
      if (!exists) {
        await this.paymentMethodRepo.save(this.paymentMethodRepo.create({ companyId: company.id, ...m }));
      }
    }

    // 7. 费用参数默认值（公司级，整数分口径）
    // 住房装修：面积×90×0.02=1.8；门面装修：面积×0.01×90=0.9
    // 住房物业费默认 1.2；门面一楼×2=2.0；门面二楼×0.7=0.7；垃圾×2.5
    const paramDefaults: { code: FeeParameterCode; value: number }[] = [
      { code: FeeParameterCode.DEPOSIT_DECORATION_AMOUNT, value: 200000 },
      { code: FeeParameterCode.DECORATION_MGMT_RATE, value: 180 },
      { code: FeeParameterCode.DECORATION_MGMT_RATE_COMMERCIAL, value: 90 },
      { code: FeeParameterCode.GARBAGE_TRANSPORT_RATE, value: 250 },
      { code: FeeParameterCode.PROPERTY_FEE_UNIT_PRICE, value: 120 },
      { code: FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL, value: 200 },
      { code: FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2, value: 70 },
    ];
    for (const param of paramDefaults) {
      const exists = await this.feeParameterRepo.findOne({
        where: { companyId: company.id, projectId: undefined as unknown as number | undefined, itemCode: param.code },
      });
      if (!exists) {
        await this.feeParameterRepo.save(
          this.feeParameterRepo.create({
            companyId: company.id,
            projectId: undefined,
            itemCode: param.code,
            value: param.value,
            effectiveAt: new Date().toISOString(),
            operatorId: undefined,
          }),
        );
        this.logger.log(`seed fee parameter ${FEE_PARAMETER_LABELS[param.code]} = ${param.value}`);
      } else if (
        param.code === FeeParameterCode.DECORATION_MGMT_RATE &&
        exists.value === 90 &&
        !exists.projectId
      ) {
        // 历史默认 0.9 元/㎡ → 纠正为面积×90×0.02=1.8 元/㎡（仅公司默认且仍为旧值时）
        await this.feeParameterRepo.save(
          this.feeParameterRepo.create({
            companyId: company.id,
            projectId: undefined,
            itemCode: param.code,
            value: 180,
            effectiveAt: new Date().toISOString(),
            operatorId: undefined,
          }),
        );
        this.logger.log('upgrade decoration mgmt rate 90 → 180 (面积×90×0.02)');
      }
    }

    // 8. 演示多项目（同公司多小区），中文名称；仅首次创建
    const demoProjects = [
      { name: '桌信花园', landArea: 52000, address: '湖南省株洲市天元区长江南路 88 号' },
      { name: '滨江壹号', landArea: 38000, address: '湖南省株洲市芦淞区建设中路 168 号' },
      { name: '神农城公馆', landArea: 41000, address: '湖南省株洲市天元区神农大道 66 号' },
      { name: '河东馨苑', landArea: 28600, address: '湖南省株洲市荷塘区新华东路 128 号' },
    ];
    for (const demo of demoProjects) {
      const exists = await this.projectRepo.findOne({ where: { companyId: company.id, name: demo.name } });
      if (!exists) {
        await this.projectRepo.save(
          this.projectRepo.create({
            companyId: company.id,
            name: demo.name,
            landArea: Math.round(demo.landArea * 100),
            address: demo.address,
            status: 'active',
          }),
        );
        this.logger.log(`seed project: ${demo.name}`);
      }
    }

    // 8.1 清理历史英文/测试项目名，改为中文演示名（幂等）
    const renamePool = ['石峰和园', '云龙金谷', '天元雅居', '芦淞翠庭', '荷塘锦绣', '清水塘府'];
    const dirty = (await this.projectRepo.find({ where: { companyId: company.id } })).filter(
      (p) => /^测试项目/.test(p.name) || /^test/i.test(p.name),
    );
    for (let i = 0; i < dirty.length; i++) {
      const p = dirty[i];
      const nextName = renamePool[i % renamePool.length];
      const clash = await this.projectRepo.findOne({ where: { companyId: company.id, name: nextName } });
      p.name = clash ? `${nextName}${i + 1}期` : nextName;
      if (!p.address) {
        p.address = `湖南省株洲市演示小区地址（原测试数据 ${p.id}）`;
      }
      await this.projectRepo.save(p);
      this.logger.log(`renamed demo project #${p.id} -> ${p.name}`);
    }

    // 9. 存量客户回填 person（身份证唯一身份）
    if (this.customerService) {
      const n = await this.customerService.backfillPersons(company.id);
      if (n > 0) this.logger.log(`backfilled person links for ${n} customers`);
    }
  }
}