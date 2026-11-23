import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey(hex: string): Buffer {
  if (!hex || hex.length < 64) {
    // 开发缺省密钥（生产必须通过 .env 提供）
    return Buffer.from('0'.repeat(64), 'hex');
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/** 敏感字段加密服务：AES-256-GCM 密文 + HMAC-SHA256 盲索引 + 脱敏 */
export class CryptoService {
  private readonly encKey: Buffer;
  private readonly blindKey: Buffer;

  constructor(encKeyHex?: string, blindKeyHex?: string) {
    this.encKey = getKey(encKeyHex ?? process.env.ENCRYPTION_KEY ?? '');
    this.blindKey = getKey(blindKeyHex ?? process.env.BLIND_INDEX_KEY ?? '');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    const decipher = createDecipheriv(ALGO, this.encKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  }

  /** 同明文盲索引恒等（等值查询） */
  blindIndex(plain: string): string {
    return createHmac('sha256', this.blindKey).update(plain).digest('hex');
  }

  /** 手机号脱敏：138****1234 */
  static maskPhone(phone: string): string {
    if (phone.length < 7) return '*'.repeat(phone.length);
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  /** 身份证脱敏：保留前 4 后 4，中间掩码 */
  static maskIdCard(idCard: string): string {
    if (idCard.length < 8) return '*'.repeat(idCard.length);
    return `${idCard.slice(0, 4)}${'*'.repeat(idCard.length - 8)}${idCard.slice(-4)}`;
  }
}

/** 身份证 18 位校验位算法（GB 11643-1999） */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

export function isValidIdCard(idCard: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(idCard)) return false;
  const sum = ID_WEIGHTS.reduce((acc, w, i) => acc + Number(idCard[i]) * w, 0);
  const expected = ID_CHECK_CODES[sum % 11];
  return idCard[17].toUpperCase() === expected;
}

/** 国内手机号格式 */
export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

/** 国内车牌格式（普通+新能源） */
export function isValidPlateNo(plate: string): boolean {
  return /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]$/.test(plate);
}