/**
 * 线上/本机功能冒烟（Node 原生 fetch）
 * 用法: node test/smoke-api.mjs [baseUrl]
 * 默认: http://8.163.8.22
 */
const base = (process.argv[2] || 'http://8.163.8.22').replace(/\/$/, '');
const api = `${base}/api/v1`;

const results = [];
function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, pass: false, detail });
  console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(method, path, { token, body, expectCode } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  if (expectCode != null && res.status !== expectCode) {
    throw new Error(`HTTP ${res.status}, expect ${expectCode}: ${text.slice(0, 300)}`);
  }
  return { res, json };
}

async function main() {
  // 1. health
  try {
    const { json } = await req('GET', '/health');
    if (json?.code === 0 || json?.data?.status === 'up' || json?.status === 'up') {
      ok('健康检查', JSON.stringify(json.data ?? json));
    } else {
      fail('健康检查', JSON.stringify(json));
    }
  } catch (e) {
    fail('健康检查', e.message);
  }

  // 2. login
  let token = '';
  try {
    const { json } = await req('POST', '/auth/login', {
      body: { username: 'admin', password: 'admin123' },
    });
    token = json?.data?.accessToken || json?.data?.token || json?.accessToken || '';
    if (json?.code === 0 && token) ok('管理端登录', `token长度=${token.length}`);
    else fail('管理端登录', JSON.stringify(json).slice(0, 300));
  } catch (e) {
    fail('管理端登录', e.message);
  }
  if (!token) {
    console.log('\n无 token，后续鉴权用例跳过');
    summarize();
    process.exit(1);
  }

  // 3. projects
  let projectId;
  try {
    const { json } = await req('GET', '/projects?pageSize=20', { token });
    const list = json?.data?.list ?? json?.list ?? [];
    projectId = list[0]?.id;
    if (json?.code === 0 && list.length) {
      ok('项目列表', `${list.length} 个，首个=${list[0].name}#${projectId}`);
      const p = list[0];
      if (p.propertyFeeUnitPriceCommercialL2 == null && p.propertyFeeUnitPriceCommercial == null) {
        fail('项目列表含门面单价字段', JSON.stringify(p).slice(0, 200));
      } else {
        ok(
          '项目列表含门面单价字段',
          `一楼=${p.propertyFeeUnitPriceCommercial} 二楼=${p.propertyFeeUnitPriceCommercialL2}`,
        );
      }
    } else fail('项目列表', JSON.stringify(json).slice(0, 300));
  } catch (e) {
    fail('项目列表', e.message);
  }

  // 4. fee parameters
  try {
    const { json } = await req('GET', '/fee-parameters', { token });
    const data = json?.data ?? json;
    const codes = Object.keys(data || {});
    const need = [
      'DECORATION_MGMT_RATE',
      'DECORATION_MGMT_RATE_COMMERCIAL',
      'PROPERTY_FEE_UNIT_PRICE',
      'PROPERTY_FEE_UNIT_PRICE_COMMERCIAL',
      'PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2',
      'GARBAGE_TRANSPORT_RATE',
    ];
    const missing = need.filter((c) => data?.[c] == null);
    if (json?.code === 0 && missing.length === 0) {
      ok(
        '费用参数齐全',
        `住房装修=${data.DECORATION_MGMT_RATE} 门面装修=${data.DECORATION_MGMT_RATE_COMMERCIAL} 一楼=${data.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL} 二楼=${data.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2}`,
      );
    } else fail('费用参数齐全', `missing=${missing.join(',')} body=${JSON.stringify(data).slice(0, 300)}`);
  } catch (e) {
    fail('费用参数齐全', e.message);
  }

  // 5. customers list
  let roomNo;
  let customerId;
  try {
    const q = projectId ? `?projectId=${projectId}&pageSize=5` : '?pageSize=5';
    const { json } = await req('GET', `/customers${q}`, { token });
    const list = json?.data?.list ?? json?.list ?? [];
    if (json?.code === 0) {
      ok('客户列表', `${list.length} 条`);
      const c = list[0];
      if (c) {
        roomNo = c.roomNo;
        customerId = c.id;
        if (c.propertyType) ok('客户含房屋性质', `${c.name} ${c.roomNo} ${c.propertyType}`);
        else fail('客户含房屋性质', JSON.stringify(c).slice(0, 200));
      }
    } else fail('客户列表', JSON.stringify(json).slice(0, 300));
  } catch (e) {
    fail('客户列表', e.message);
  }

  // 6. delivery preview
  if (projectId && roomNo) {
    try {
      const { json } = await req('POST', '/fees/preview/delivery', {
        token,
        body: { projectId: String(projectId), roomNo },
      });
      if (json?.code === 0 && Array.isArray(json?.data?.feeItems)) {
        const items = json.data.feeItems;
        ok(
          '交房预览',
          `${roomNo} 共${items.length}项 合计=${json.data.totalReceivable} 依据样例=${items[1]?.calcBasis?.slice(0, 60)}`,
        );
      } else if (json?.code && json.code !== 0) {
        // 业务拒绝也算接口通
        ok('交房预览(业务返回)', `${json.code} ${json.message}`);
      } else fail('交房预览', JSON.stringify(json).slice(0, 400));
    } catch (e) {
      fail('交房预览', e.message);
    }
  }

  // 7. charges/delivery DTO：缺 projectId 装饰器曾导致 400
  if (projectId && roomNo) {
    try {
      const { res, json } = await req('POST', '/charges/delivery', {
        token,
        body: {
          projectId: String(projectId),
          roomNo,
          paymentMethodCode: 'CASH',
        },
      });
      const msg = json?.message || '';
      if (String(msg).includes('projectId should not exist')) {
        fail('交房提交 DTO', '仍报 projectId should not exist');
      } else if (res.status === 400 && /should not exist/i.test(String(msg))) {
        fail('交房提交 DTO', msg);
      } else {
        ok('交房提交 DTO 接受 projectId', `HTTP ${res.status} code=${json?.code} msg=${json?.message || ''}`);
      }
    } catch (e) {
      fail('交房提交 DTO', e.message);
    }
  }

  // 8. owner projects briefs（公开）
  try {
    const { json } = await req('GET', '/owner/projects/briefs');
    const list = json?.data ?? json;
    if (Array.isArray(list) && list.length) ok('业主端小区列表', `${list.length} 个`);
    else if (json?.code === 0) ok('业主端小区列表', '空列表也可');
    else fail('业主端小区列表', JSON.stringify(json).slice(0, 300));
  } catch (e) {
    fail('业主端小区列表', e.message);
  }

  // 9. owner verify 手机号路径（预期不匹配，但不该 500）
  if (projectId) {
    try {
      const { res, json } = await req('POST', '/owner/auth/verify', {
        body: { projectId: String(projectId), phone: '13800000000' },
      });
      if (res.status >= 500) fail('业主手机号验证', `HTTP ${res.status}`);
      else ok('业主手机号验证接口可用', `HTTP ${res.status} code=${json?.code} msg=${json?.message || ''}`);
    } catch (e) {
      fail('业主手机号验证接口可用', e.message);
    }
  }

  // 10. fee-status
  if (customerId) {
    try {
      const { json } = await req('GET', `/fees/fee-status?customerId=${customerId}`, { token });
      if (json?.code === 0) {
        ok(
          '欠费状态',
          `单价=${json.data?.unitPrice} 性质=${json.data?.propertyType} 欠费=${json.data?.arrearsAmount}`,
        );
      } else fail('欠费状态', JSON.stringify(json).slice(0, 300));
    } catch (e) {
      fail('欠费状态', e.message);
    }
  }

  summarize();
}

function summarize() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n======== 冒烟汇总 ========');
  console.log(`通过 ${passed} / 失败 ${failed} / 合计 ${results.length}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
