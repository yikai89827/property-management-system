<template>
  <div class="home" v-loading="loading">
    <div class="welcome">
      <div>
        <h2 class="welcome-title">工作台</h2>
        <p class="welcome-sub">
          {{ auth.userInfo?.realName || auth.userInfo?.username }}
          <template v-if="roleNames"> · {{ roleNames }}</template>
          · {{ auth.userInfo?.companyName }}
        </p>
      </div>
      <el-button v-if="showBossCharts" link type="primary" @click="$router.push('/statistics')">
        更多统计 →
      </el-button>
    </div>

    <!-- 财务：按项目日/月收费明细与分类汇总 -->
    <FinanceWorkbench v-if="showFinanceWorkbench" />

    <!-- 老板等管理层：经营数据图表 -->
    <template v-else-if="showBossCharts">
      <div class="kpi-row">
        <div class="kpi" v-for="k in kpis" :key="k.label">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value" :class="k.tone">{{ k.value }}</div>
          <div class="kpi-hint">{{ k.hint }}</div>
        </div>
      </div>

      <el-row :gutter="16" class="chart-row">
        <el-col :xs="24" :md="14">
          <el-card shadow="never" class="panel">
            <template #header>
              <div class="panel-head">
                <span>{{ year }} 年实收趋势</span>
                <el-button link type="primary" @click="$router.push('/statistics')">明细</el-button>
              </div>
            </template>
            <div v-show="hasTrend" ref="trendRef" class="chart" />
            <el-empty v-if="!loading && !hasTrend" description="本年暂无收费数据" :image-size="64" />
          </el-card>
        </el-col>
        <el-col :xs="24" :md="10">
          <el-card shadow="never" class="panel">
            <template #header>
              <div class="panel-head">
                <span>本月费用构成</span>
                <el-button link type="primary" @click="$router.push('/statistics')">分类统计</el-button>
              </div>
            </template>
            <div v-show="hasCategory" ref="categoryRef" class="chart" />
            <el-empty v-if="!loading && !hasCategory" description="本月暂无分类数据" :image-size="64" />
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never" class="panel">
        <template #header>
          <div class="panel-head">
            <span>欠费关注（前 8 户）</span>
            <el-button link type="primary" @click="$router.push('/statistics')">全部欠费</el-button>
          </div>
        </template>
        <el-table v-if="arrearsTop.length" :data="arrearsTop" size="small" border>
          <el-table-column prop="projectName" label="项目" min-width="120" />
          <el-table-column prop="roomNo" label="房号" width="100" />
          <el-table-column prop="customerName" label="业主" width="100" />
          <el-table-column prop="arrearsMonths" label="欠费月数" width="90" align="right" />
          <el-table-column label="欠费金额" width="120" align="right">
            <template #default="{ row }">{{ yuan(row.arrearsAmount) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="当前无欠费户" :image-size="64" />
      </el-card>
    </template>

    <!-- 业务人员：简要待办 -->
    <template v-else>
      <el-card shadow="never" class="panel">
        <template #header>待办事项</template>
        <div v-if="todos.length" class="todo-list">
          <button
            v-for="t in todos"
            :key="t.path + t.title"
            type="button"
            class="todo-item"
            @click="$router.push(t.path)"
          >
            <span class="todo-badge" :class="t.level">{{ t.countLabel }}</span>
            <span class="todo-body">
              <span class="todo-title">{{ t.title }}</span>
              <span class="todo-desc">{{ t.desc }}</span>
            </span>
            <span class="todo-go">去处理 →</span>
          </button>
        </div>
        <el-empty v-else description="暂无待办，可从下方入口办理业务" :image-size="72" />
      </el-card>

      <el-card shadow="never" class="panel">
        <template #header>常用入口</template>
        <div class="quick-row">
          <el-button
            v-for="q in opsQuick"
            :key="q.path"
            type="primary"
            plain
            @click="$router.push(q.path)"
          >
            {{ q.title }}
          </el-button>
        </div>
      </el-card>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { BuiltInRoles, PermissionCodes } from '@pms/shared';
import { http } from '@/api/request';
import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import FinanceWorkbench from './FinanceWorkbench.vue';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const auth = useAuthStore();
const theme = useThemeStore();

const MANAGEMENT_ROLE_CODES = new Set<string>([
  BuiltInRoles.COMPANY_ADMIN,
  BuiltInRoles.FINANCE,
  BuiltInRoles.PROJECT_ADMIN,
]);
const FRONTLINE_ROLE_CODES = new Set<string>([BuiltInRoles.CASHIER, BuiltInRoles.STAFF]);

const loading = ref(false);
const year = String(new Date().getFullYear());
const monthSummary = ref({ receivableAmount: 0, receivedAmount: 0, discountAmount: 0, orderCount: 0 });
const yearMonths = ref<{ month: string; summary: { receivedAmount: number; receivableAmount: number } }[]>([]);
const categoryRows = ref<{ category: string; receivedAmount: number }[]>([]);
const arrearsTop = ref<Record<string, any>[]>([]);
const arrearsTotalAmount = ref(0);
const arrearsCount = ref(0);
const pendingConfirmTotal = ref(0);

const trendRef = ref<HTMLDivElement>();
const categoryRef = ref<HTMLDivElement>();
let trendChart: echarts.ECharts | null = null;
let categoryChart: echarts.ECharts | null = null;

const roleNames = computed(() => (auth.userInfo?.roles ?? []).map((r) => r.name).join('、'));
const canStats = computed(() => auth.hasPermission(PermissionCodes.STATISTIC_MONTHLY_VIEW));
const isFinanceRole = computed(() => (auth.userInfo?.roles ?? []).some((r) => r.code === BuiltInRoles.FINANCE));

const isManagement = computed(() => {
  const roles = auth.userInfo?.roles ?? [];
  if (roles.some((r) => MANAGEMENT_ROLE_CODES.has(r.code))) return true;
  if (roles.length > 0 && roles.every((r) => FRONTLINE_ROLE_CODES.has(r.code))) return false;
  return (
    auth.hasPermission(PermissionCodes.USER_MANAGE) ||
    auth.hasPermission(PermissionCodes.STATISTIC_MONTHLY_VIEW) ||
    auth.hasPermission(PermissionCodes.FEE_PARAMETER_MANAGE)
  );
});

/** 财务角色：项目日/月收费与分类汇总工作台 */
const showFinanceWorkbench = computed(() => isFinanceRole.value && canStats.value);
/** 老板等（非纯财务）：经营概览图表；同时有财务角色时以财务台为准 */
const showBossCharts = computed(() => isManagement.value && canStats.value && !showFinanceWorkbench.value);

function yuan(cents: number) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`;
}

const kpis = computed(() => [
  { label: '本月实收', value: yuan(monthSummary.value.receivedAmount), hint: `${monthSummary.value.orderCount} 笔单据`, tone: 'ok' },
  { label: '本月应收', value: yuan(monthSummary.value.receivableAmount), hint: '有效收款单口径', tone: '' },
  { label: '本月优惠', value: yuan(monthSummary.value.discountAmount), hint: '已入账优惠合计', tone: '' },
  {
    label: '欠费概况',
    value: yuan(arrearsTotalAmount.value),
    hint: `${arrearsCount.value} 户欠费`,
    tone: arrearsCount.value > 0 ? 'warn' : 'ok',
  },
]);

const hasTrend = computed(() => yearMonths.value.some((m) => (m.summary?.receivedAmount ?? 0) > 0));
const hasCategory = computed(() => categoryRows.value.some((c) => (c.receivedAmount ?? 0) > 0));

const todos = computed(() => {
  const list: { title: string; desc: string; path: string; countLabel: string; level: string }[] = [];
  if (auth.hasPermission(PermissionCodes.PAYMENT_RECORD_CONFIRM)) {
    list.push({
      title: '待确认收款',
      desc: pendingConfirmTotal.value > 0 ? '业主扫码/登记后需核销到账' : '当前无待确认记录',
      path: '/payment-confirm',
      countLabel: String(pendingConfirmTotal.value),
      level: pendingConfirmTotal.value > 0 ? 'warn' : 'muted',
    });
  }
  if (auth.hasPermission(PermissionCodes.CHARGE_PROPERTY_EXECUTE)) {
    list.push({
      title: '物业费续费',
      desc: '办理周期物业费续缴',
      path: '/charging/property',
      countLabel: '办',
      level: 'info',
    });
  }
  if (auth.hasPermission(PermissionCodes.CHARGE_DELIVERY_EXECUTE)) {
    list.push({
      title: '交房缴费',
      desc: '新交付房屋一次性费用',
      path: '/charging/delivery',
      countLabel: '办',
      level: 'info',
    });
  }
  if (auth.hasPermission(PermissionCodes.CUSTOMER_VIEW)) {
    list.push({
      title: '客户档案',
      desc: '查询/维护业主与房屋信息',
      path: '/customers',
      countLabel: '查',
      level: 'muted',
    });
  }
  return list;
});

const opsQuick = computed(() =>
  [
    { path: '/customers', title: '客户档案', permission: PermissionCodes.CUSTOMER_VIEW },
    { path: '/charging/delivery', title: '交房缴费', permission: PermissionCodes.CHARGE_DELIVERY_EXECUTE },
    { path: '/charging/property', title: '物业费续费', permission: PermissionCodes.CHARGE_PROPERTY_EXECUTE },
    { path: '/charging/other', title: '其他缴费', permission: PermissionCodes.CHARGE_OTHER_EXECUTE },
    { path: '/charging/receipts', title: '收款单', permission: PermissionCodes.CHARGE_RECEIPT_VIEW },
    { path: '/payment-confirm', title: '收款确认', permission: PermissionCodes.PAYMENT_RECORD_CONFIRM },
  ].filter((q) => auth.hasPermission(q.permission)),
);

function monthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { startTime: `${y}-${m}-01`, endTime: `${y}-${m}-${String(last).padStart(2, '0')}` };
}

function chartColors() {
  const dark = theme.isDark;
  return {
    text: dark ? '#c9d1d9' : '#606266',
    split: dark ? '#30363d' : '#ebeef5',
    axis: dark ? '#8b949e' : '#909399',
  };
}

function renderTrend() {
  if (!trendRef.value) return;
  if (!trendChart) trendChart = echarts.init(trendRef.value);
  const colors = chartColors();
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const map = new Map(yearMonths.value.map((m) => [m.month, m.summary]));
  const received = months.map((m) => (map.get(m)?.receivedAmount ?? 0) / 100);
  const receivable = months.map((m) => (map.get(m)?.receivableAmount ?? 0) / 100);
  trendChart.setOption({
    color: ['#409eff', '#67c23a'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['实收', '应收'], textStyle: { color: colors.text } },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: 'category',
      data: months.map((m) => `${Number(m.slice(5))}月`),
      axisLabel: { color: colors.axis },
      axisLine: { lineStyle: { color: colors.split } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: colors.axis, formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)) },
      splitLine: { lineStyle: { color: colors.split } },
    },
    series: [
      { name: '实收', type: 'bar', data: received, barMaxWidth: 18 },
      { name: '应收', type: 'line', data: receivable, smooth: true },
    ],
  });
}

function renderCategory() {
  if (!categoryRef.value) return;
  if (!categoryChart) categoryChart = echarts.init(categoryRef.value);
  const colors = chartColors();
  const data = categoryRows.value
    .filter((c) => c.receivedAmount > 0)
    .map((c) => ({ name: c.category, value: Number((c.receivedAmount / 100).toFixed(2)) }));
  categoryChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: colors.text } },
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '45%'],
        data: data.length ? data : [{ name: '暂无', value: 0 }],
        label: { color: colors.text },
      },
    ],
  });
}

function renderCharts() {
  if (!showBossCharts.value) return;
  renderTrend();
  renderCategory();
  trendChart?.resize();
  categoryChart?.resize();
}

async function loadBoss() {
  const { startTime, endTime } = monthRange();
  const [monthly, yearly, category, arrears] = await Promise.all([
    http.get<never, Record<string, number>>('/statistics/monthly', { params: { startTime, endTime } }),
    http.get<never, { months: typeof yearMonths.value }>(`/statistics/yearly`, { params: { year } }),
    http.get<never, { category: string; receivedAmount: number }[]>('/statistics/category', { params: { startTime, endTime } }),
    http.get<never, Record<string, any>[]>('/statistics/arrears'),
  ]);
  monthSummary.value = {
    receivableAmount: monthly.receivableAmount ?? 0,
    receivedAmount: monthly.receivedAmount ?? 0,
    discountAmount: monthly.discountAmount ?? 0,
    orderCount: monthly.orderCount ?? 0,
  };
  yearMonths.value = yearly.months ?? [];
  categoryRows.value = category ?? [];
  const list = Array.isArray(arrears) ? arrears : [];
  arrearsCount.value = list.length;
  arrearsTotalAmount.value = list.reduce((s, r) => s + (r.arrearsAmount ?? 0), 0);
  arrearsTop.value = [...list].sort((a, b) => (b.arrearsAmount ?? 0) - (a.arrearsAmount ?? 0)).slice(0, 8);
}

async function loadOps() {
  if (!auth.hasPermission(PermissionCodes.PAYMENT_RECORD_CONFIRM)) {
    pendingConfirmTotal.value = 0;
    return;
  }
  try {
    const data = await http.get<never, { list: unknown[]; total?: number }>('/payments/records', {
      params: { status: 'pending', page: 1, pageSize: 1 },
    });
    pendingConfirmTotal.value = data.total ?? data.list?.length ?? 0;
  } catch {
    pendingConfirmTotal.value = 0;
  }
}

async function load() {
  if (showFinanceWorkbench.value) return;
  loading.value = true;
  try {
    if (showBossCharts.value) {
      await loadBoss();
      await nextTick();
      renderCharts();
    } else {
      await loadOps();
    }
  } finally {
    loading.value = false;
  }
}

function onResize() {
  trendChart?.resize();
  categoryChart?.resize();
}

watch(
  () => theme.isDark,
  async () => {
    await nextTick();
    renderCharts();
  },
);

onMounted(async () => {
  await load();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  trendChart?.dispose();
  categoryChart?.dispose();
  trendChart = null;
  categoryChart = null;
});
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.welcome {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
.welcome-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.welcome-sub {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 960px) {
  .kpi-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.kpi {
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
}
.kpi-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.kpi-value {
  margin-top: 6px;
  font-size: 22px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  font-variant-numeric: tabular-nums;
}
.kpi-value.ok { color: var(--el-color-success); }
.kpi-value.warn { color: var(--el-color-warning); }
.kpi-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.chart-row { margin-top: 0; }
.panel { margin-top: 0; }
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.chart {
  height: 280px;
  width: 100%;
}
.todo-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-bg-color);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.todo-item:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}
.todo-badge {
  flex-shrink: 0;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  color: #fff;
  background: var(--el-color-info);
}
.todo-badge.warn { background: var(--el-color-warning); }
.todo-badge.info { background: var(--el-color-primary); }
.todo-badge.muted { background: var(--el-color-info-light-3); color: var(--el-text-color-primary); }
.todo-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.todo-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.todo-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.todo-go {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-color-primary);
}
.quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
