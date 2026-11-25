import { HouseStatus } from '../enums';

/** 业务错误码（与 design 2.2.2 错误码表逐字一致） */
export const ErrorCodes = {
  VALIDATION_FAILED: 'PMS-1001',
  UNAUTHORIZED: 'PMS-1002',
  FORBIDDEN: 'PMS-1003',
  PROJECT_NAME_DUP: 'PMS-2001',
  ROOM_NO_NOT_FOUND: 'PMS-3001',
  ROOM_NO_DUP: 'PMS-3002',
  ID_CARD_INVALID: 'PMS-3003',
  HOUSE_AREA_INVALID: 'PMS-3004',
  STATUS_TRANSITION_INVALID: 'PMS-3005',
  ID_CARD_PERSON_MISMATCH: 'PMS-3006',
  ID_CARD_REQUIRED: 'PMS-3007',
  FEE_ALREADY_PAID: 'PMS-4001',
  DEDUCT_EXCEED_LIMIT: 'PMS-4002',
  DISCOUNT_EXCEED_RECEIVABLE: 'PMS-4003',
  RECEIVED_NEGATIVE: 'PMS-4004',
  PROPERTY_FEE_PAID_OFF: 'PMS-4005',
  CHARGE_MONTHS_INVALID: 'PMS-4006',
  OWNER_VERIFY_MISMATCH: 'PMS-5001',
  DUPLICATE_PAYMENT: 'PMS-5002',
  ACCOUNT_DISABLED: 'PMS-6001',
  INTERNAL_ERROR: 'PMS-9000',
  NOT_IMPLEMENTED_PHASE2: 'PMS-9100',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ErrorMessages: Record<ErrorCode, string> = {
  'PMS-1001': '参数校验失败',
  'PMS-1002': '未登录或登录已失效',
  'PMS-1003': '无权限执行该操作',
  'PMS-2001': '项目名称已存在',
  'PMS-3001': '该房号不存在客户档案',
  'PMS-3002': '该房号已存在客户档案',
  'PMS-3003': '身份证号格式不正确',
  'PMS-3004': '房屋面积必须大于 0',
  'PMS-3005': '状态流转不合法',
  'PMS-3006': '该身份证已登记为其他姓名，请核对后重试',
  'PMS-3007': '身份证号为必填项（业主/租户唯一标识）',
  'PMS-4001': '该费用已缴纳',
  'PMS-4002': '抵扣金额超出可抵扣上限',
  'PMS-4003': '优惠金额不得超过应交金额',
  'PMS-4004': '实收金额不得为负',
  'PMS-4005': '该客户物业费已缴清',
  'PMS-4006': '续费月数不合法（须为正整数且不超剩余应交费月份）',
  'PMS-5001': '客户信息不匹配，请核对后重试',
  'PMS-5002': '该笔费用正在处理中或已缴纳',
  'PMS-6001': '账号已停用',
  'PMS-9000': '系统内部错误',
  'PMS-9100': '该功能属于二期开发范围',
};

/**
 * 房屋状态流转矩阵（spec 5.2.1 规则 5）：
 * - "未交房→已交房"仅允许由交房缴费事务触发，不提供手工变更路径；
 * - 空置与已入住可互换。
 */
export const HouseStatusTransitionMatrix: Record<HouseStatus, HouseStatus[]> = {
  [HouseStatus.UNDELIVERED]: [HouseStatus.DELIVERED],
  [HouseStatus.DELIVERED]: [HouseStatus.DECORATING, HouseStatus.OCCUPIED, HouseStatus.VACANT],
  [HouseStatus.DECORATING]: [HouseStatus.OCCUPIED, HouseStatus.VACANT],
  [HouseStatus.OCCUPIED]: [HouseStatus.VACANT, HouseStatus.DECORATING],
  [HouseStatus.VACANT]: [HouseStatus.OCCUPIED, HouseStatus.DECORATING],
};

/** 收款单固定备注文案（spec 5.4.1，逐字一致） */
export const RECEIPT_FIXED_REMARK = '该单据不作为报销凭证，如需发票请当月到物业中心领取。';

/** 权限点清单（design 2.5.1 命名） */
export const PermissionCodes = {
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_VIEW: 'project:view',
  CUSTOMER_CREATE: 'customer:create',
  CUSTOMER_UPDATE: 'customer:update',
  CUSTOMER_VIEW: 'customer:view',
  /** 已确认档案的核心字段解锁修改 */
  CUSTOMER_PROFILE_UNLOCK: 'customer:profile_unlock',
  CHARGE_DELIVERY_EXECUTE: 'charge:delivery:execute',
  CHARGE_PROPERTY_EXECUTE: 'charge:property:execute',
  CHARGE_OTHER_EXECUTE: 'charge:other:execute',
  CHARGE_RECEIPT_VIEW: 'charge:receipt:view',
  PAYMENT_RECORD_CONFIRM: 'payment:record:confirm',
  STATISTIC_MONTHLY_VIEW: 'statistic:monthly:view',
  STATISTIC_YEARLY_VIEW: 'statistic:yearly:view',
  STATISTIC_CATEGORY_VIEW: 'statistic:category:view',
  STATISTIC_ARREARS_VIEW: 'statistic:arrears:view',
  STATISTIC_RECEIVABLE_VIEW: 'statistic:receivable:view',
  STATISTIC_RECEIVED_VIEW: 'statistic:received:view',
  STATISTIC_DISCOUNT_VIEW: 'statistic:discount:view',
  STATISTIC_DEPOSIT_VIEW: 'statistic:deposit:view',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  AUDIT_VIEW: 'audit:view',
  FEE_PARAMETER_MANAGE: 'fee-parameter:manage',
  DICT_MANAGE: 'dict:manage',
} as const;

export type PermissionCode = (typeof PermissionCodes)[keyof typeof PermissionCodes];

/** 权限点分组（前端权限树分组展示） */
export const PERMISSION_GROUPS: { group: string; permissions: { code: PermissionCode; name: string; type: 'operation' | 'query_scope' }[] }[] = [
  {
    group: '组织与客户',
    permissions: [
      { code: PermissionCodes.PROJECT_VIEW, name: '项目查询', type: 'query_scope' },
      { code: PermissionCodes.PROJECT_CREATE, name: '项目新建', type: 'operation' },
      { code: PermissionCodes.PROJECT_UPDATE, name: '项目修改', type: 'operation' },
      { code: PermissionCodes.CUSTOMER_VIEW, name: '客户查询', type: 'query_scope' },
      { code: PermissionCodes.CUSTOMER_CREATE, name: '客户新建', type: 'operation' },
      { code: PermissionCodes.CUSTOMER_UPDATE, name: '客户修改', type: 'operation' },
      { code: PermissionCodes.CUSTOMER_PROFILE_UNLOCK, name: '客户档案解锁修改', type: 'operation' },
    ],
  },
  {
    group: '缴费办理',
    permissions: [
      { code: PermissionCodes.CHARGE_DELIVERY_EXECUTE, name: '交房缴费办理', type: 'operation' },
      { code: PermissionCodes.CHARGE_PROPERTY_EXECUTE, name: '物业费续费办理', type: 'operation' },
      { code: PermissionCodes.CHARGE_OTHER_EXECUTE, name: '其他缴费办理', type: 'operation' },
      { code: PermissionCodes.CHARGE_RECEIPT_VIEW, name: '收款单查询', type: 'query_scope' },
      { code: PermissionCodes.PAYMENT_RECORD_CONFIRM, name: '收款确认', type: 'operation' },
    ],
  },
  {
    group: '统计报表',
    permissions: [
      { code: PermissionCodes.STATISTIC_MONTHLY_VIEW, name: '月度统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_YEARLY_VIEW, name: '年度统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_CATEGORY_VIEW, name: '分类统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_ARREARS_VIEW, name: '欠费统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_RECEIVABLE_VIEW, name: '应收统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_RECEIVED_VIEW, name: '实收统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_DISCOUNT_VIEW, name: '优惠统计', type: 'query_scope' },
      { code: PermissionCodes.STATISTIC_DEPOSIT_VIEW, name: '押金统计', type: 'query_scope' },
    ],
  },
  {
    group: '系统管理',
    permissions: [
      { code: PermissionCodes.USER_MANAGE, name: '员工账号管理', type: 'operation' },
      { code: PermissionCodes.ROLE_MANAGE, name: '角色管理', type: 'operation' },
      { code: PermissionCodes.AUDIT_VIEW, name: '审计日志查询', type: 'query_scope' },
      { code: PermissionCodes.FEE_PARAMETER_MANAGE, name: '费用参数配置', type: 'operation' },
      { code: PermissionCodes.DICT_MANAGE, name: '字典管理', type: 'operation' },
    ],
  },
];

/** 内置角色（禁删） */
export const BuiltInRoles = {
  COMPANY_ADMIN: 'company_admin',
  FINANCE: 'finance',
  PROJECT_ADMIN: 'project_admin',
  CASHIER: 'cashier',
  STAFF: 'staff',
} as const;

export type BuiltInRole = (typeof BuiltInRoles)[keyof typeof BuiltInRoles];

/** 费用类别字典种子编码（spec 5.5 其他缴费筛选项） */
export const FEE_CATEGORY_SEEDS = [
  { code: 'WALL_DEMOLITION', name: '打墙费' },
  { code: 'GARAGE_MGMT', name: '车库管理费' },
  { code: 'ELECTRICITY', name: '电费' },
  { code: 'WATER', name: '水费' },
  { code: 'ADVERTISING', name: '广告费' },
  { code: 'SERVICE', name: '服务费' },
];

/** 收款方式字典种子 */
export const PAYMENT_METHOD_SEEDS = [
  { code: 'CASH', name: '现金' },
  { code: 'BANK_TRANSFER', name: '银行转账' },
  { code: 'MOBILE_PAY', name: '移动支付' },
  { code: 'POS', name: 'POS' },
  { code: 'CHEQUE', name: '支票' },
];