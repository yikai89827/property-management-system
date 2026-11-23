import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CommonStatus, HouseStatus, ResidentType } from '@pms/shared';

@Entity('company')
export class CompanyEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'name', unique: true })
  name!: string;

  @Column({ name: 'status', default: CommonStatus.ACTIVE })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: string;
}

@Entity('project')
@Index(['companyId', 'name'], { unique: true })
export class ProjectEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'name', length: 50 })
  name!: string;

  /** 占地面积（㎡×100 百分位整数） */
  @Column({ name: 'land_area' })
  landArea!: number;

  /** 项目地址/小区位置（多项目场景展示） */
  @Column({ name: 'address', length: 200, nullable: true })
  address?: string;

  @Column({ name: 'status', default: CommonStatus.ACTIVE })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: string;
}

/**
 * 自然人身份主体：同一物业公司内以身份证号（盲索引）唯一标识。
 * 同一人可在多个小区/项目下拥有多套房源档案（customer）。
 */
@Entity('person')
@Index(['companyId', 'idCardBlindIndex'], { unique: true })
@Index(['companyId', 'phoneBlindIndex'])
export class PersonEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'name' })
  name!: string;

  @Column({ name: 'phone_encrypted', type: 'text' })
  phoneEncrypted!: string;

  @Column({ name: 'phone_blind_index' })
  phoneBlindIndex!: string;

  @Column({ name: 'id_card_encrypted', type: 'text' })
  idCardEncrypted!: string;

  @Column({ name: 'id_card_blind_index' })
  idCardBlindIndex!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: string;
}

@Entity('customer')
@Index(['companyId', 'projectId', 'roomNo'], { unique: true })
@Index(['companyId', 'projectId', 'name'])
@Index(['companyId', 'projectId', 'phoneBlindIndex'])
@Index(['companyId', 'personId'])
@Index(['companyId', 'idCardBlindIndex'])
export class CustomerEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'project_id' })
  projectId!: number;

  /** 关联自然人（身份证唯一身份） */
  @Column({ name: 'person_id', nullable: true })
  personId?: number;

  /** 业主 / 租户 */
  @Column({ name: 'resident_type', default: ResidentType.OWNER })
  residentType!: string;

  @Column({ name: 'name' })
  name!: string;

  /** AES-256-GCM 密文 */
  @Column({ name: 'phone_encrypted', type: 'text' })
  phoneEncrypted!: string;

  /** HMAC-SHA256 盲索引 */
  @Column({ name: 'phone_blind_index' })
  phoneBlindIndex!: string;

  @Column({ name: 'room_no' })
  roomNo!: string;

  @Column({ name: 'id_card_encrypted', type: 'text' })
  idCardEncrypted!: string;

  @Column({ name: 'id_card_blind_index' })
  idCardBlindIndex!: string;

  /** 房屋面积，单位 0.01㎡（百分位整数，杜绝浮点） */
  @Column({ name: 'house_area' })
  houseArea!: number;

  @Column({ name: 'contract_date', nullable: true })
  contractDate?: string;

  /** 物业费起始时间（YYYY-MM-DD） */
  @Column({ name: 'fee_start_date' })
  feeStartDate!: string;

  @Column({ name: 'decorate_date', nullable: true })
  decorateDate?: string;

  @Column({ name: 'delivery_date', nullable: true })
  deliveryDate?: string;

  @Column({ name: 'house_status', default: HouseStatus.UNDELIVERED })
  houseStatus!: string;

  /** 扩展字段 JSON */
  @Column({ name: 'ext', type: 'text', nullable: true })
  ext?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: string;

  /** 逻辑删除（有缴费记录的客户禁止删除） */
  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: string;
}

@Entity('vehicle_plate')
@Index(['customerId', 'plateNo'], { unique: true })
export class VehiclePlateEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'plate_no' })
  plateNo!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('customer_change_log')
@Index(['customerId', 'changedAt'])
export class CustomerChangeLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'operator_id' })
  operatorId!: number;

  @Column({ name: 'field_name' })
  fieldName!: string;

  /** 敏感字段旧新值均脱敏后存留 */
  @Column({ name: 'old_value', nullable: true })
  oldValue?: string;

  @Column({ name: 'new_value', nullable: true })
  newValue?: string;

  @Column({ name: 'changed_at' })
  changedAt!: string;
}
export const orgEntities = [
  CompanyEntity,
  ProjectEntity,
  PersonEntity,
  CustomerEntity,
  VehiclePlateEntity,
  CustomerChangeLogEntity,
];
