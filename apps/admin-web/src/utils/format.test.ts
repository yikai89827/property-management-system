import { decorateStatusLabel, fieldLabel, formatDateTime } from './format';

describe('formatDateTime 东八区', () => {
  it('UTC ISO 转为北京时间', () => {
    expect(formatDateTime('2026-11-25T06:10:25.674Z')).toBe('2026-11-25 14:10:25');
  });

  it('空值与纯日期', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('2026-01-01')).toBe('2026-01-01');
  });

  it('无时区标记的截断串按 UTC 再转东八区', () => {
    expect(formatDateTime('2026-11-25 06:07:15')).toBe('2026-11-25 14:07:15');
  });
});

describe('字段中文标签', () => {
  it('英文码映射中文', () => {
    expect(fieldLabel('profileConfirmed')).toBe('档案确认');
    expect(fieldLabel('resale')).toBe('房屋转售');
    expect(fieldLabel('propertyType')).toBe('房屋性质');
  });

  it('已是中文则原样返回', () => {
    expect(fieldLabel('房屋转售')).toBe('房屋转售');
  });

  it('装修报备状态中文', () => {
    expect(decorateStatusLabel('active')).toBe('有效');
    expect(decorateStatusLabel('closed')).toBe('已关闭');
  });
});
