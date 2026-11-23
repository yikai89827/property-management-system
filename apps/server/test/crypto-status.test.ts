import { isValidIdCard, isValidPhone, isValidPlateNo, CryptoService } from '../src/common/crypto/crypto.service';
import { HouseStatus, HouseStatusTransitionMatrix } from '@pms/shared';

describe('身份证 18 位校验位算法', () => {
  it('合法身份证（校验位正确）通过', () => {
    expect(isValidIdCard('110101199003077598')).toBe(true);
  });

  it('校验位错误拒绝', () => {
    expect(isValidIdCard('110101199003077590')).toBe(false);
    expect(isValidIdCard('11010119900307759X')).toBe(false);
  });

  it('位数不足 / 非法字符拒绝', () => {
    expect(isValidIdCard('1101011990030775')).toBe(false);
    expect(isValidIdCard('11010119900307abcX')).toBe(false);
    expect(isValidIdCard('')).toBe(false);
  });
});

describe('手机号与车牌格式校验', () => {
  it('国内手机号格式', () => {
    expect(isValidPhone('13800138000')).toBe(true);
    expect(isValidPhone('12345678901')).toBe(false);
    expect(isValidPhone('1380013800')).toBe(false);
  });

  it('国内车牌格式（普通+新能源）', () => {
    expect(isValidPlateNo('湘B12345')).toBe(true);
    expect(isValidPlateNo('湘BD12345')).toBe(true);
    expect(isValidPlateNo('AB12345')).toBe(false);
  });
});

describe('加密服务：AES-256-GCM 加解密与 HMAC 盲索引', () => {
  const crypto = new CryptoService('a'.repeat(64), 'b'.repeat(64));

  it('密文可解密还原', () => {
    const plain = '13800138000';
    const cipher = crypto.encrypt(plain);
    expect(cipher).not.toContain(plain);
    expect(crypto.decrypt(cipher)).toBe(plain);
  });

  it('同明文盲索引恒等（支持等值查询）', () => {
    expect(crypto.blindIndex('13800138000')).toBe(crypto.blindIndex('13800138000'));
    expect(crypto.blindIndex('13800138000')).not.toBe(crypto.blindIndex('13800138001'));
  });

  it('脱敏输出符合中间位掩码规则', () => {
    expect(CryptoService.maskPhone('13800138000')).toBe('138****8000');
    expect(CryptoService.maskIdCard('110101199003077598')).toMatch(/^1101\*+7598$/);
  });
});

describe('房屋状态流转矩阵（spec 5.2.1 规则 5）', () => {
  it('未交房仅可流转到已交房（且仅由交房缴费事务触发）', () => {
    expect(HouseStatusTransitionMatrix[HouseStatus.UNDELIVERED]).toEqual([HouseStatus.DELIVERED]);
  });

  it('非法流转：未交房 → 装修中 被拒绝', () => {
    expect(HouseStatusTransitionMatrix[HouseStatus.UNDELIVERED]).not.toContain(HouseStatus.DECORATING);
  });

  it('空置与已入住可互换', () => {
    expect(HouseStatusTransitionMatrix[HouseStatus.OCCUPIED]).toContain(HouseStatus.VACANT);
    expect(HouseStatusTransitionMatrix[HouseStatus.VACANT]).toContain(HouseStatus.OCCUPIED);
  });

  it('已交房可进入装修/入住/空置', () => {
    const allowed = HouseStatusTransitionMatrix[HouseStatus.DELIVERED];
    expect(allowed).toContain(HouseStatus.DECORATING);
    expect(allowed).toContain(HouseStatus.OCCUPIED);
    expect(allowed).toContain(HouseStatus.VACANT);
  });
});