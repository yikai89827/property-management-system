/** 统一展示：日期时间 → 北京时间（东八区）年-月-日 时:分:秒 */
export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const s = String(value).trim();
  if (!s) return '—';
  // 仅日期（无时分秒）保持原样
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = parseToDate(s);
  if (!d || Number.isNaN(d.getTime())) return s.slice(0, 19);

  // 以 Asia/Shanghai 输出，避免本机时区干扰
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** 解析 ISO / 空格分隔时间为 Date；无时区标记的按 UTC 理解（与后端 toISOString 一致） */
function parseToDate(s: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return new Date(s);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    // 旧数据/截断串按 UTC 墙钟理解，再转东八区展示
    return new Date(`${s.replace(' ', 'T').slice(0, 19)}Z`);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 仅日期：年-月-日 */
export function formatDate(value?: string | null): string {
  if (!value) return '—';
  return String(value).trim().slice(0, 10);
}

/** 客户变更字段英文码 → 中文 */
export const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  phone: '电话',
  idCard: '身份证号',
  roomNo: '房号',
  houseArea: '房屋面积',
  houseStatus: '房屋状态',
  residentType: '住户类型',
  propertyType: '房屋性质',
  contractDate: '合同签约',
  feeStartDate: '物业费起始',
  decorateDate: '装修时间',
  deliveryDate: '交房时间',
  projectId: '所属项目',
  profileConfirmed: '档案确认',
  profileUnlock: '档案解锁',
  resale: '房屋转售',
  ext: '扩展信息',
};

export function fieldLabel(code?: string | null): string {
  if (!code) return '—';
  return CUSTOMER_FIELD_LABELS[code] ?? code;
}

/** 装修报备状态 */
export const DECORATE_STATUS_LABELS: Record<string, string> = {
  active: '有效',
  closed: '已关闭',
};

export function decorateStatusLabel(status?: string | null): string {
  if (!status) return '—';
  return DECORATE_STATUS_LABELS[status] ?? status;
}
