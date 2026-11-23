import { ChargeType, DiscountType, FeeItemCode, HouseStatus, ReceiptStatus } from '../enums';

/** 通用分页请求 */
export interface PageRequest {
  page?: number;
  pageSize?: number;
}

/** 通用分页响应 */
export interface PageResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 统一响应体 */
export interface ApiResponse<T = unknown> {
  code: number | string;
  message: string;
  data: T;
}

/** 参数快照（引擎锁定的参数上下文，随单据固化） */
export interface ParameterSnapshot {
  [itemCode: string]: number;
}

/** 客户概要（脱敏） */
export interface CustomerSummary {
  id: number;
  name: string;
  roomNo: string;
  houseAreaFen: number;
  houseStatus: HouseStatus;
}

/** 费用明细预览行 */
export interface FeeItemPreview {
  feeItemCode: FeeItemCode;
  amount: number;
  calcBasis: string;
  parameterSnapshot: ParameterSnapshot;
}

/* ============ A. 费用预览：POST /api/v1/fees/preview/delivery ============ */
export interface DeliveryFeePreviewRequest {
  roomId: string;
}
export interface DeliveryFeePreviewResponse {
  customer: CustomerSummary;
  feeItems: FeeItemPreview[];
  totalReceivable: number;
}

/* ============ B. 交房缴费提交：POST /api/v1/charges/delivery ============ */
export interface DeliveryChargeRequest {
  roomId: string;
  discountType?: DiscountType;
  discountAmount?: number;
  depositDeduct?: number;
  paymentMethodCode: string;
}
export interface ChargeReceiptResponse {
  orderNo: string;
  receivableAmount: number;
  discountAmount: number;
  depositDeduct: number;
  receivedAmount: number;
  items: FeeItemPreview[];
  remark: string;
}

/* ============ C. 物业费续费提交：POST /api/v1/charges/property ============ */
export interface PropertyFeePreviewRequest {
  roomId: string;
  months?: number;
}
export interface PropertyFeePreviewResponse {
  customer: CustomerSummary;
  billingInfo: {
    feeStartMonth: string;
    feeEndMonth: string;
    totalBillableMonths: number;
    paidMonths: number;
    remainingMonths: number;
    houseAreaSnapshot: number;
    unitPriceSnapshot: number;
    receivableAmount: number;
    months: number;
  };
}
export interface PropertyFeeChargeRequest {
  roomId: string;
  months: number;
  startMonth: string;
  discountType?: DiscountType;
  discountAmount?: number;
  depositDeduct?: number;
  paymentMethodCode: string;
}
export interface PropertyFeeChargeResponse extends ChargeReceiptResponse {
  billingInfo: PropertyFeePreviewResponse['billingInfo'];
}

/* ============ 其他缴费：POST /api/v1/charges/other ============ */
export interface OtherChargeRequest {
  roomId: string;
  feeCategoryCode: string;
  amount: number;
  discountAmount?: number;
  paymentMethodCode: string;
}

/* ============ 收款单查询 ============ */
export interface ReceiptOrderQuery extends PageRequest {
  startTime?: string;
  endTime?: string;
  chargeType?: ChargeType;
  feeCategoryCode?: string;
  roomNo?: string;
}
export interface ReceiptOrderSummary {
  id: number;
  orderNo: string;
  projectName: string;
  customerName: string;
  roomNo: string;
  houseStatus: HouseStatus;
  chargeType: ChargeType;
  receivableAmount: number;
  discountAmount: number;
  depositDeduct: number;
  receivedAmount: number;
  status: ReceiptStatus;
  payeeName: string;
  paidAt: string;
}
export interface ReceiptOrderDetail extends ReceiptOrderSummary {
  items: FeeItemPreview[];
  remark: string;
  payerSnapshot: Record<string, unknown>;
}

/* ============ 客户档案 ============ */
export interface CustomerCreateRequest {
  projectId: number;
  name: string;
  phone: string;
  roomNo: string;
  idCard: string;
  houseArea: number;
  contractDate?: string;
  feeStartDate: string;
  decorateDate?: string;
  deliveryDate?: string;
  houseStatus: HouseStatus;
  ext?: Record<string, unknown>;
}
export interface CustomerUpdateRequest {
  name?: string;
  phone?: string;
  idCard?: string;
  houseArea?: number;
  contractDate?: string;
  feeStartDate?: string;
  decorateDate?: string;
  houseStatus?: HouseStatus;
  ext?: Record<string, unknown>;
}
export interface CustomerDetailView extends CustomerSummary {
  projectId: number;
  projectName: string;
  phoneMasked: string;
  idCardMasked: string;
  contractDate?: string;
  feeStartDate: string;
  decorateDate?: string;
  deliveryDate?: string;
  plates: string[];
  ext?: Record<string, unknown>;
}
export interface CustomerQuery extends PageRequest {
  projectId?: number;
  roomNo?: string;
  name?: string;
  phone?: string;
}

/* ============ 项目 ============ */
export interface ProjectCreateRequest {
  name: string;
  landArea: number;
}
export interface ProjectView {
  id: number;
  name: string;
  landArea: number;
  createdAt: string;
}

/* ============ 客户欠费状态 ============ */
export interface FeeStatusResponse {
  feeStartMonth: string;
  totalBillableMonths: number;
  paidMonths: number;
  remainingMonths: number;
  arrearsMonths: number;
  arrearsAmount: number;
  paidLedgers: { startMonth: string; endMonth: string; months: number; status: string }[];
}

/* ============ 统计 ============ */
export interface StatisticQuery {
  startTime?: string;
  endTime?: string;
  projectIds?: number[];
  feeCategoryCode?: string;
}
export interface StatisticSummary {
  receivableAmount: number;
  receivedAmount: number;
  discountAmount: number;
  depositAmount: number;
  orderCount: number;
}
export interface MonthlyStatisticResponse {
  month: string;
  summary: StatisticSummary;
}
export interface YearlyStatisticResponse {
  year: string;
  months: MonthlyStatisticResponse[];
  total: StatisticSummary;
}
export interface CategoryStatisticRow {
  category: string;
  receivableAmount: number;
  receivedAmount: number;
  discountAmount: number;
  orderCount: number;
}
export interface ArrearsRow {
  projectId: number;
  projectName: string;
  roomNo: string;
  customerName: string;
  arrearsMonths: number;
  arrearsAmount: number;
}

/* ============ 认证 ============ */
export interface LoginRequest {
  username: string;
  password: string;
}
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  userInfo: {
    id: number;
    username: string;
    realName: string;
    companyName: string;
    permissions: string[];
    allProjectsScope: boolean;
    projectScopes: number[];
  };
}

/* ============ 业主端 ============ */
export interface OwnerVerifyRequest {
  roomId: string;
  name: string;
  phoneLast4: string;
}
export interface OwnerVerifyResponse {
  ownerToken: string;
  customerBrief: { name: string; roomNo: string; houseStatus: HouseStatus };
}
export interface OwnerArrearsResponse extends FeeStatusResponse {}
export interface OwnerChargePropertyRequest {
  months: number;
  startMonth: string;
  declaredPaymentMethodCode: string;
  declaredTradeNo?: string;
}
export interface OwnerReceiptItem {
  orderNo: string;
  projectName: string;
  chargeType: ChargeType;
  receivableAmount: number;
  discountAmount: number;
  depositDeduct: number;
  receivedAmount: number;
  paidAt: string;
  status: ReceiptStatus;
}

/* ============ 用户与权限 ============ */
export interface UserView {
  id: number;
  username: string;
  realName: string;
  status: string;
  allProjectsScope: boolean;
  projectScopes: number[];
  roles: string[];
}
export interface UserCreateRequest {
  username: string;
  password: string;
  realName: string;
  roleCodes: string[];
}
export interface UserPermissionConfig {
  overrides: { permissionCode: string; overrideType: 'allow' | 'deny' }[];
  projectIds: number[];
  allProjectsScope: boolean;
}