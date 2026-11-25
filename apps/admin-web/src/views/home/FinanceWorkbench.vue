<template>
  <div class="finance" v-loading="loading">
    <el-card shadow="never" class="filter-card">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="当前项目">
          <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
        </el-form-item>
        <el-form-item label="粒度">
          <el-radio-group v-model="grain" @change="onGrainChange">
            <el-radio-button value="day">按日</el-radio-button>
            <el-radio-button value="month">按月</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="grain === 'day' ? '日期' : '月份'">
          <el-date-picker
            v-if="grain === 'day'"
            v-model="dayRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            :clearable="false"
          />
          <el-date-picker
            v-else
            v-model="monthRange"
            type="monthrange"
            value-format="YYYY-MM"
            start-placeholder="开始月"
            end-placeholder="结束月"
            :clearable="false"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button link type="primary" @click="$router.push('/statistics')">完整统计 →</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="kpi-row">
      <div class="kpi" v-for="k in kpis" :key="k.label">
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-value" :class="k.tone">{{ k.value }}</div>
        <div class="kpi-hint">{{ k.hint }}</div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header>{{ grain === 'day' ? '每日收费趋势' : '每月收费趋势' }}</template>
          <div v-show="hasPeriod" ref="periodRef" class="chart" />
          <el-empty v-if="!loading && !hasPeriod" description="所选区间暂无收费" :image-size="64" />
        </el-card>
      </el-col>
      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header>费用分类汇总</template>
          <div v-show="hasCategory" ref="categoryRef" class="chart" />
          <el-empty v-if="!loading && !hasCategory" description="暂无分类数据" :image-size="64" />
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header>各项目收费对比</template>
      <div v-show="hasProject" ref="projectRef" class="chart chart-sm" />
      <el-empty v-if="!loading && !hasProject" description="暂无项目收费" :image-size="64" />
      <el-table v-if="byProject.length" :data="byProject" size="small" border style="margin-top: 12px">
        <el-table-column prop="projectName" label="项目" min-width="140" />
        <el-table-column label="实收" align="right" width="120">
          <template #default="{ row }">{{ yuan(row.receivedAmount) }}</template>
        </el-table-column>
        <el-table-column label="应收" align="right" width="120">
          <template #default="{ row }">{{ yuan(row.receivableAmount) }}</template>
        </el-table-column>
        <el-table-column label="优惠" align="right" width="110">
          <template #default="{ row }">{{ yuan(row.discountAmount) }}</template>
        </el-table-column>
        <el-table-column prop="orderCount" label="笔数" width="80" align="right" />
      </el-table>
    </el-card>

    <el-row :gutter="16">
      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header>分类汇总表</template>
          <el-table v-if="byCategory.length" :data="byCategory" size="small" border max-height="360">
            <el-table-column prop="categoryLabel" label="费用类别" min-width="120" />
            <el-table-column label="实收" align="right" width="110">
              <template #default="{ row }">{{ yuan(row.receivedAmount) }}</template>
            </el-table-column>
            <el-table-column prop="orderCount" label="笔数" width="70" align="right" />
          </el-table>
          <el-empty v-else description="暂无分类" :image-size="56" />
        </el-card>
      </el-col>
      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header>
            <div class="panel-head">
              <span>收费明细（最近 100 笔）</span>
              <el-button link type="primary" @click="$router.push('/charging/receipts')">全部收款单 →</el-button>
            </div>
          </template>
          <el-table v-if="details.length" :data="details" size="small" border max-height="360">
            <el-table-column prop="createdAt" label="时间" width="160">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column prop="projectName" label="项目" min-width="100" show-overflow-tooltip />
            <el-table-column prop="roomNo" label="房号" width="80" />
            <el-table-column prop="customerName" label="业主" width="90" show-overflow-tooltip />
            <el-table-column prop="chargeTypeLabel" label="类型" width="100" />
            <el-table-column label="实收" align="right" width="100">
              <template #default="{ row }">{{ yuan(row.receivedAmount) }}</template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无明细" :image-size="56" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { http } from '@/api/request';
import { useCurrentProject } from '@/composables/useCurrentProject';
import { useThemeStore } from '@/stores/theme';
import { formatDateTime } from '@/utils/format';

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface FinanceOverview {
  grain: 'day' | 'month';
  projects: { id: number; name: string; address?: string }[];
  summary: { receivableAmount: number; receivedAmount: number; discountAmount: number; orderCount: number };
  byProject: {
    projectId: number;
    projectName: string;
    receivableAmount: number;
    receivedAmount: number;
    discountAmount: number;
    orderCount: number;
  }[];
  byPeriod: { period: string; receivableAmount: number; receivedAmount: number; discountAmount: number; orderCount: number }[];
  byCategory: { category: string; categoryLabel: string; receivedAmount: number; orderCount: number }[];
  details: Record<string, any>[];
}

const theme = useThemeStore();
const { projectStore, currentProjectId, projectName } = useCurrentProject({
  onChange: () => {
    void load();
  },
});
const loading = ref(false);
const grain = ref<'day' | 'month'>('day');
const dayRange = ref<[string, string]>(defaultDayRange());
const monthRange = ref<[string, string]>(defaultMonthRange());

const summary = ref({ receivableAmount: 0, receivedAmount: 0, discountAmount: 0, orderCount: 0 });
const byProject = ref<FinanceOverview['byProject']>([]);
const byPeriod = ref<FinanceOverview['byPeriod']>([]);
const byCategory = ref<FinanceOverview['byCategory']>([]);
const details = ref<Record<string, any>[]>([]);

const periodRef = ref<HTMLDivElement>();
const categoryRef = ref<HTMLDivElement>();
const projectRef = ref<HTMLDivElement>();
let periodChart: echarts.ECharts | null = null;
let categoryChart: echarts.ECharts | null = null;
let projectChart: echarts.ECharts | null = null;

function defaultDayRange(): [string, string] {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return [`${y}-${m}-01`, `${y}-${m}-${d}`];
}

function defaultMonthRange(): [string, string] {
  const y = new Date().getFullYear();
  const m = String(new Date().getMonth() + 1).padStart(2, '0');
  return [`${y}-01`, `${y}-${m}`];
}

function onGrainChange() {
  if (grain.value === 'day') dayRange.value = defaultDayRange();
  else monthRange.value = defaultMonthRange();
  void load();
}

function yuan(cents: number) {
  return `¥${(Number(cents || 0) / 100).toFixed(2)}`;
}

function formatTime(v: string) {
  return formatDateTime(v);
}

const kpis = computed(() => [
  { label: '实收合计', value: yuan(summary.value.receivedAmount), hint: `${summary.value.orderCount} 笔`, tone: 'ok' },
  { label: '应收合计', value: yuan(summary.value.receivableAmount), hint: '有效收款单', tone: '' },
  { label: '优惠合计', value: yuan(summary.value.discountAmount), hint: '已入账优惠', tone: '' },
  {
    label: '当前项目',
    value: projectName.value,
    hint: currentProjectId.value ? `ID ${currentProjectId.value}` : '请先在顶部选择',
    tone: '',
  },
]);

const hasPeriod = computed(() => byPeriod.value.some((p) => p.receivedAmount > 0 || p.orderCount > 0));
const hasCategory = computed(() => byCategory.value.some((c) => c.receivedAmount > 0));
const hasProject = computed(() => byProject.value.some((p) => p.receivedAmount > 0));

function chartColors() {
  const dark = theme.isDark;
  return {
    text: dark ? '#c9d1d9' : '#606266',
    split: dark ? '#30363d' : '#ebeef5',
    axis: dark ? '#8b949e' : '#909399',
  };
}

function renderPeriod() {
  if (!periodRef.value) return;
  if (!periodChart) periodChart = echarts.init(periodRef.value);
  const colors = chartColors();
  const labels = byPeriod.value.map((p) => (grain.value === 'day' ? p.period.slice(5) : p.period));
  periodChart.setOption({
    color: ['#409eff', '#67c23a'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['实收', '应收'], textStyle: { color: colors.text } },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: colors.axis, rotate: grain.value === 'day' && labels.length > 14 ? 40 : 0 },
      axisLine: { lineStyle: { color: colors.split } },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: colors.axis,
        formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)),
      },
      splitLine: { lineStyle: { color: colors.split } },
    },
    series: [
      { name: '实收', type: 'bar', data: byPeriod.value.map((p) => p.receivedAmount / 100), barMaxWidth: 22 },
      { name: '应收', type: 'bar', data: byPeriod.value.map((p) => p.receivableAmount / 100), barMaxWidth: 22 },
    ],
  });
}

function renderCategory() {
  if (!categoryRef.value) return;
  if (!categoryChart) categoryChart = echarts.init(categoryRef.value);
  const colors = chartColors();
  const data = byCategory.value
    .filter((c) => c.receivedAmount > 0)
    .map((c) => ({ name: c.categoryLabel, value: Number((c.receivedAmount / 100).toFixed(2)) }));
  categoryChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: colors.text } },
    series: [
      {
        type: 'pie',
        radius: ['40%', '66%'],
        center: ['50%', '44%'],
        data,
        label: { color: colors.text },
      },
    ],
  });
}

function renderProject() {
  if (!projectRef.value) return;
  if (!projectChart) projectChart = echarts.init(projectRef.value);
  const colors = chartColors();
  const rows = [...byProject.value].slice(0, 12);
  projectChart.setOption({
    color: ['#e6a23c'],
    tooltip: { trigger: 'axis' },
    grid: { left: 100, right: 24, top: 16, bottom: 28 },
    xAxis: {
      type: 'value',
      axisLabel: { color: colors.axis },
      splitLine: { lineStyle: { color: colors.split } },
    },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.projectName).reverse(),
      axisLabel: { color: colors.axis },
    },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => r.receivedAmount / 100).reverse(),
        barMaxWidth: 16,
        label: { show: true, position: 'right', color: colors.text, formatter: (p: any) => `¥${Number(p.value).toFixed(0)}` },
      },
    ],
  });
}

function renderCharts() {
  renderPeriod();
  renderCategory();
  renderProject();
  periodChart?.resize();
  categoryChart?.resize();
  projectChart?.resize();
}

async function load() {
  loading.value = true;
  try {
    const params: Record<string, string> = { grain: grain.value };
    if (grain.value === 'day' && dayRange.value?.length === 2) {
      params.startTime = dayRange.value[0];
      params.endTime = dayRange.value[1];
    }
    if (grain.value === 'month' && monthRange.value?.length === 2) {
      params.startTime = `${monthRange.value[0]}-01`;
      const [ey, em] = monthRange.value[1].split('-').map(Number);
      const last = new Date(ey, em, 0).getDate();
      params.endTime = `${monthRange.value[1]}-${String(last).padStart(2, '0')}`;
    }
    if (currentProjectId.value) params.projectIds = String(currentProjectId.value);

    const res = await http.get<never, FinanceOverview>('/statistics/finance-overview', { params });
    summary.value = res.summary ?? { receivableAmount: 0, receivedAmount: 0, discountAmount: 0, orderCount: 0 };
    byProject.value = res.byProject ?? [];
    byPeriod.value = res.byPeriod ?? [];
    byCategory.value = res.byCategory ?? [];
    details.value = res.details ?? [];
    await nextTick();
    renderCharts();
  } finally {
    loading.value = false;
  }
}

function onResize() {
  periodChart?.resize();
  categoryChart?.resize();
  projectChart?.resize();
}

watch(
  () => theme.isDark,
  async () => {
    await nextTick();
    renderCharts();
  },
);

onMounted(async () => {
  if (!projectStore.loaded) await projectStore.loadOptions();
  await load();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  periodChart?.dispose();
  categoryChart?.dispose();
  projectChart?.dispose();
  periodChart = null;
  categoryChart = null;
  projectChart = null;
});
</script>

<style scoped>
.finance {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.filter-card :deep(.el-form-item) {
  margin-bottom: 0;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 960px) {
  .kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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
.kpi-value.ok {
  color: var(--el-color-success);
}
.kpi-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.chart {
  height: 280px;
  width: 100%;
}
.chart-sm {
  height: 220px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
</style>
