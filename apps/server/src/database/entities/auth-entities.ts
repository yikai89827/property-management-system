import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BuiltInRoles, CommonStatus, PermissionOverrideType, PermissionType } from '@pms/shared';

@Entity('user')
@Index(['companyId', 'username'], { unique: true })
export class UserEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'username' })
  username!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'real_name' })
  realName!: string;

  @Column({ name: 'status', default: CommonStatus.ACTIVE })
  status!: string;

  /** 停用时间（离职生效路径） */
  @Column({ name: 'disabled_at', nullable: true })
  disabledAt?: string;

  /** 最近登录时间；为空表示从未登录过（允许物理删除） */
  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt?: string;

  /** 项目数据范围：是否全部项目 */
  @Column({ name: 'all_projects_scope', default: false })
  allProjectsScope!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: string;
}

@Entity('role')
@Index(['companyId', 'code'], { unique: true })
export class RoleEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'code' })
  code!: string;

  @Column({ name: 'name' })
  name!: string;

  /** 内置角色禁删 */
  @Column({ name: 'built_in', default: false })
  builtIn!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('permission')
@Index(['code'], { unique: true })
export class PermissionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'code' })
  code!: string;

  @Column({ name: 'name' })
  name!: string;

  /** operation / query_scope 分组 */
  @Column({ name: 'type', type: 'text'})
  type!: PermissionType;

  @Column({ name: 'group_name' })
  groupName!: string;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder!: number;
}

@Entity('user_role')
@Index(['userId', 'roleId'], { unique: true })
export class UserRoleEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @Column({ name: 'role_id' })
  roleId!: number;
}

@Entity('role_permission')
@Index(['roleId', 'permissionId'], { unique: true })
export class RolePermissionEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'role_id' })
  roleId!: number;

  @Column({ name: 'permission_id' })
  permissionId!: number;
}

/** 用户权限覆盖（允许/拒绝） */
@Entity('user_permission_override')
@Index(['userId', 'permissionCode'], { unique: true })
export class UserPermissionOverrideEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @Column({ name: 'permission_code' })
  permissionCode!: string;

  @Column({ name: 'override_type', type: 'text'})
  overrideType!: PermissionOverrideType;
}

/** 用户项目数据范围 */
@Entity('user_project_scope')
@Index(['userId', 'projectId'], { unique: true })
export class UserProjectScopeEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @Column({ name: 'project_id' })
  projectId!: number;
}

/** 审计日志（无修改删除路径，防篡改） */
@Entity('audit_log')
@Index(['companyId', 'createdAt'])
@Index(['companyId', 'operatorId'])
@Index(['companyId', 'actionType'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'operator_id', nullable: true })
  operatorId?: number;

  @Column({ name: 'operator_name', nullable: true })
  operatorName?: string;

  @Column({ name: 'action_type' })
  actionType!: string;

  @Column({ name: 'action_content', type: 'text'})
  actionContent!: string;

  @Column({ name: 'result' })
  result!: string;

  @Column({ name: 'created_at' })
  createdAt!: string;
}

/** 客户扩展字段注册表（受控注册机制） */
@Entity('ext_key_registry')
@Index(['companyId', 'keyName'], { unique: true })
export class ExtKeyRegistryEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'key_name' })
  keyName!: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column({ name: 'value_type', default: 'string' })
  valueType!: string;

  @Column({ name: 'required', default: false })
  required!: boolean;

  @Column({ name: 'validation_rule', nullable: true })
  validationRule?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 内置角色编码导出（种子使用） */
export const BUILT_IN_ROLE_CODES = BuiltInRoles;
export const authEntities = [
  UserEntity,
  RoleEntity,
  PermissionEntity,
  UserRoleEntity,
  RolePermissionEntity,
  UserPermissionOverrideEntity,
  UserProjectScopeEntity,
  AuditLogEntity,
  ExtKeyRegistryEntity,
];
