import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationOutboxStatus, NotificationType, WorkOrderStatus } from '@pms/shared';

/* ============ 二期框架域实体（仅建表契约，一期业务代码不写入） ============ */

/** 工单（状态机：待处理→处理中→已完成→已关闭） */
@Entity('work_order')
@Index(['companyId', 'projectId', 'status'])
export class WorkOrderEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'project_id' })
  projectId!: number;

  @Column({ name: 'title' })
  title!: string;

  @Column({ name: 'content', type: 'text', nullable: true })
  content?: string;

  @Column({ name: 'customer_id', nullable: true })
  customerId?: number;

  @Column({ name: 'assignee_id', nullable: true })
  assigneeId?: number;

  @Column({ name: 'status', default: WorkOrderStatus.PENDING, type: 'text'})
  status!: WorkOrderStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('work_order_event')
@Index(['workOrderId', 'createdAt'])
export class WorkOrderEventEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'work_order_id' })
  workOrderId!: number;

  @Column({ name: 'event_type' })
  eventType!: string;

  @Column({ name: 'operator_id', nullable: true })
  operatorId?: number;

  @Column({ name: 'content', type: 'text', nullable: true })
  content?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 员工（敏感字段双列存储） */
@Entity('employee')
@Index(['companyId', 'empNo'], { unique: true })
export class EmployeeEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'emp_no' })
  empNo!: string;

  @Column({ name: 'name' })
  name!: string;

  @Column({ name: 'id_card_encrypted', type: 'text', nullable: true })
  idCardEncrypted?: string;

  @Column({ name: 'id_card_blind_index', nullable: true })
  idCardBlindIndex?: string;

  @Column({ name: 'department', nullable: true })
  department?: string;

  @Column({ name: 'position', nullable: true })
  position?: string;

  @Column({ name: 'entry_date', nullable: true })
  entryDate?: string;

  @Column({ name: 'leave_date', nullable: true })
  leaveDate?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('attendance_record')
@Index(['companyId', 'employeeId', 'attendanceDate'])
export class AttendanceRecordEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'employee_id' })
  employeeId!: number;

  @Column({ name: 'attendance_date' })
  attendanceDate!: string;

  @Column({ name: 'check_in_at', nullable: true })
  checkInAt?: string;

  @Column({ name: 'check_out_at', nullable: true })
  checkOutAt?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('expense_request')
@Index(['companyId', 'status'])
export class ExpenseRequestEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'requester_id' })
  requesterId!: number;

  @Column({ name: 'title' })
  title!: string;

  @Column({ name: 'amount' })
  amount!: number;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason?: string;

  @Column({ name: 'status', default: 'PENDING' })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('approval_task')
@Index(['companyId', 'status'])
export class ApprovalTaskEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'biz_type' })
  bizType!: string;

  @Column({ name: 'biz_id' })
  bizId!: number;

  @Column({ name: 'approver_id' })
  approverId!: number;

  @Column({ name: 'status', default: 'PENDING' })
  status!: string;

  @Column({ name: 'remark', type: 'text', nullable: true })
  remark?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('value_added_service')
@Index(['companyId', 'code'], { unique: true })
export class ValueAddedServiceEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'code' })
  code!: string;

  @Column({ name: 'name' })
  name!: string;

  @Column({ name: 'price' })
  price!: number;

  @Column({ name: 'enabled', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

@Entity('service_order')
@Index(['companyId', 'customerId'])
export class ServiceOrderEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'service_id' })
  serviceId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'amount' })
  amount!: number;

  @Column({ name: 'status', default: 'PENDING' })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}

/** 通知 outbox（缴费确认/驳回触发，二期公众号渠道注册后零业务改动投递） */
@Entity('notification_outbox')
@Index(['companyId', 'customerId', 'status'])
export class NotificationOutboxEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'company_id' })
  companyId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'type', type: 'text'})
  type!: NotificationType;

  @Column({ name: 'title' })
  title!: string;

  @Column({ name: 'content', type: 'text'})
  content!: string;

  @Column({ name: 'biz_ref', nullable: true })
  bizRef?: string;

  @Column({ name: 'status', default: NotificationOutboxStatus.PENDING, type: 'text'})
  status!: NotificationOutboxStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: string;
}
export const phase2Entities = [
  WorkOrderEntity,
  WorkOrderEventEntity,
  EmployeeEntity,
  AttendanceRecordEntity,
  ExpenseRequestEntity,
  ApprovalTaskEntity,
  ValueAddedServiceEntity,
  ServiceOrderEntity,
  NotificationOutboxEntity,
];
