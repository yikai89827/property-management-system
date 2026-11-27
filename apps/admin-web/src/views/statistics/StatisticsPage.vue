<template>
  <el-card>
    <template #header>统计报表（八类）</template>
    <el-form inline>
      <el-form-item label="当前项目">
        <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
      </el-form-item>
      <el-form-item label="统计类型">
        <el-select v-model="kind" style="width: 140px" @change="load">
          <el-option v-for="o in kindOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="年度" v-if="kind === 'yearly'">
        <el-date-picker v-model="year" type="year" value-format="YYYY" :clearable="false" />
      </el-form-item>
      <el-form-item label="统计截止月" v-if="kind === 'arrears'">
        <el-date-picker v-model="asOfMonth" type="month" value-format="YYYY-MM" :clearable="false" />
      </el-form-item>
      <el-form-item label="时间范围" v-if="kind !== 'yearly' && kind !== 'arrears'">
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load">查询</el-button>
        <el-button :disabled="!exportRows.length" @click="exportXlsx">导出 Excel</el-button>
      </el-form-item>
    </el-form>

    <el-table v-if="exportRows.length" :data="exportRows" border>
      <el-table-column
        v-for="col in currentColumns"
        :key="col.key"
        :prop="col.key"
        :label="col.label"
        :min-width="col.minWidth ?? 120"
        :align="col.align ?? 'left'"
      />
    </el-table>

    <el-empty v-if="loaded && exportRows.length === 0" description="该周期内暂无收费数据" />
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import * as XLSX from 'xlsx';
import { DISCOUNT_TYPE_LABELS, FEE_ITEM_LABELS, FeeItemCode, type DiscountType } from '@pms/shared';
import { http } from '@/api/request';
import { useCurrentProject } from '@/composables/useCurrentProject';
import { formatDateTime } from '@/utils/format';

type StatKind = 'monthly' | 'yearly' | 'category' | 'arrears' | 'receivable' | 'received' | 'discount' | 'deposit';

interface ColumnDef {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  minWidth?: number;
}

const kindOptions: { value: StatKind; label: string }[] = [
  { value: 'monthly', label: '月度统计' },
  { value: 'yearly', label: '年度统计' },
  { value: 'category', label: '分类统计' },
  { value: 'arrears', label: '欠费统计' },
  { value: 'receivable', label: '应收统计' },
  { value: 'received', label: '实收统计' },
  { value: 'discount', label: '优惠统计' },
  { value: 'deposit', label: '押金统计' },
];

const { projectStore, currentProjectId, projectName } = useCurrentProject({
  onChange: () => {
    void load();
  },
});
const kind = ref<StatKind>('monthly');
const year = ref(String(new Date().getFullYear()));
const asOfMonth = ref(new Date().toISOString().slice(0, 7));
const range = ref<[string, string] | null>(null);
const exportRows = ref<Record<string, string | number>[]>([]);
const loaded = ref(false);

const kindLabel = computed(() => kindOptions.find((o) => o.value === kind.value)?.label ?? kind.value);

const summaryColumns: ColumnDef[] = [
  { key: '期间', label: '期间', minWidth: 140 },
  { key: '应收（元）', label: '应收（元）', align: 'right' },
  { key: '实收（元）', label: '实收（元）', align: 'right' },
  { key: '优惠（元）', label: '优惠（元）', align: 'right' },
  { key: '押金（元）', label: '押金（元）', align: 'right' },
  { key: '单据数', label: '单据数', align: 'right', minWidth: 90 },
];

const columnMap: Record<StatKind, ColumnDef[]> = {
  monthly: summaryColumns,
  yearly: summaryColumns,
  category: [
    { key: '费用类别', label: '费用类别', minWidth: 160 },
    { key: '应收（元）', label: '应收（元）', align: 'right' },
    { key: '实收（元）', label: '实收（元）', align: 'right' },
    { key: '优惠（元）', label: '优惠（元）', align: 'right' },
    { key: '单据数', label: '单据数', align: 'right', minWidth: 90 },
  ],
  arrears: [
    { key: '项目', label: '项目', minWidth: 140 },
    { key: '房号', label: '房号', minWidth: 100 },
    { key: '业主', label: '业主', minWidth: 100 },
    { key: '物业费起始', label: '物业费起始', minWidth: 120 },
    { key: '统计截止月', label: '统计截止月', minWidth: 110 },
    { key: '应计月数', label: '应计月数', align: 'right', minWidth: 90 },
    { key: '已缴月数', label: '已缴月数', align: 'right', minWidth: 90 },
    { key: '欠费月数', label: '欠费月数', align: 'right', minWidth: 90 },
    { key: '欠费金额（元）', label: '欠费金额（元）', align: 'right', minWidth: 130 },
  ],
  receivable: [
    { key: '单据编号', label: '单据编号', minWidth: 160 },
    { key: '应收（元）', label: '应收（元）', align: 'right' },
    { key: '优惠（元）', label: '优惠（元）', align: 'right' },
    { key: '实收（元）', label: '实收（元）', align: 'right' },
  ],
  received: [
    { key: '单据编号', label: '单据编号', minWidth: 160 },
    { key: '实收（元）', label: '实收（元）', align: 'right' },
    { key: '收款日期', label: '收款日期', minWidth: 160 },
  ],
  discount: [
    { key: '单据编号', label: '单据编号', minWidth: 160 },
    { key: '优惠类型', label: '优惠类型', minWidth: 120 },
    { key: '优惠（元）', label: '优惠（元）', align: 'right' },
  ],
  deposit: [
    { key: '项目编号', label: '项目编号', minWidth: 100 },
    { key: '押金（元）', label: '押金（元）', align: 'right' },
  ],
};

const currentColumns = computed(() => columnMap[kind.value]);

function yuan(cents: number | undefined | null) {
  return Number(((Number(cents) || 0) / 100).toFixed(2));
}

function categoryLabel(code: string) {
  if (!code) return '—';
  if (code?.startsWith('OTHER:')) {
    const raw = code.slice(6);
    return `其他·${FEE_ITEM_LABELS[raw as FeeItemCode] ?? raw}`;
  }
  return FEE_ITEM_LABELS[code as FeeItemCode] ?? code;
}

function discountLabel(code: string | undefined) {
  if (!code) return '—';
  return DISCOUNT_TYPE_LABELS[code as DiscountType] ?? code;
}

function formatTime(v: string | undefined) {
  return formatDateTime(v);
}

function mapSummaryRow(label: string, s: Record<string, any>) {
  return {
    期间: label,
    '应收（元）': yuan(s.receivableAmount),
    '实收（元）': yuan(s.receivedAmount),
    '优惠（元）': yuan(s.discountAmount),
    '押金（元）': yuan(s.depositAmount),
    单据数: s.orderCount ?? 0,
  };
}

function normalizeRows(res: Record<string, any> | Record<string, any>[]): Record<string, string | number>[] {
  if (kind.value === 'monthly') {
    return [mapSummaryRow('本期合计', res as Record<string, any>)];
  }
  if (kind.value === 'yearly') {
    const data = res as { year: string; months?: { month: string; summary: Record<string, any> }[]; total: Record<string, any> };
    return [
      ...(data.months ?? []).map((m) => mapSummaryRow(m.month, m.summary)),
      mapSummaryRow(`${data.year} 合计`, data.total ?? {}),
    ];
  }
  const list = Array.isArray(res) ? res : [];
  if (kind.value === 'category') {
    return list.map((r) => ({
      费用类别: r.categoryLabel || categoryLabel(r.category),
      '应收（元）': yuan(r.receivableAmount),
      '实收（元）': yuan(r.receivedAmount),
      '优惠（元）': yuan(r.discountAmount),
      单据数: r.orderCount ?? 0,
    }));
  }
  if (kind.value === 'arrears') {
    return list.map((r) => ({
      项目: r.projectName ?? '',
      房号: r.roomNo ?? '',
      业主: r.customerName ?? '',
      物业费起始: r.feeStartDate ?? '',
      统计截止月: r.feeEndMonth ?? r.asOfMonth ?? asOfMonth.value,
      应计月数: r.totalBillableMonths ?? 0,
      已缴月数: r.paidMonths ?? 0,
      欠费月数: r.arrearsMonths ?? 0,
      '欠费金额（元）': yuan(r.arrearsAmount),
    }));
  }
  if (kind.value === 'receivable') {
    return list.map((r) => ({
      单据编号: r.orderNo ?? '',
      '应收（元）': yuan(r.receivableAmount),
      '优惠（元）': yuan(r.discountAmount),
      '实收（元）': yuan(r.receivedAmount),
    }));
  }
  if (kind.value === 'received') {
    return list.map((r) => ({
      单据编号: r.orderNo ?? '',
      '实收（元）': yuan(r.receivedAmount),
      收款日期: formatTime(r.paidAt),
    }));
  }
  if (kind.value === 'discount') {
    return list.map((r) => ({
      单据编号: r.orderNo ?? '',
      优惠类型: discountLabel(r.discountType),
      '优惠（元）': yuan(r.discountAmount),
    }));
  }
  return list.map((r) => ({
    项目编号: r.projectId ?? '',
    '押金（元）': yuan(r.depositAmount),
  }));
}

async function load() {
  const params: Record<string, any> = {};
  if (currentProjectId.value) params.projectIds = String(currentProjectId.value);
  if (kind.value === 'yearly') params.year = year.value;
  if (kind.value === 'arrears' && asOfMonth.value) params.asOf = asOfMonth.value;
  if (range.value && kind.value !== 'yearly' && kind.value !== 'arrears') {
    params.startTime = range.value[0];
    params.endTime = range.value[1];
  }
  const res = await http.get<never, Record<string, any>>(`/statistics/${kind.value}`, { params });
  loaded.value = true;
  exportRows.value = normalizeRows(res);
}

function exportXlsx() {
  if (!exportRows.value.length) {
    ElMessage.warning('暂无数据可导出');
    return;
  }
  const cols = currentColumns.value;
  const header = cols.map((c) => c.label);
  const aoa: (string | number)[][] = [
    header,
    ...exportRows.value.map((row) => cols.map((c) => row[c.key] ?? '')),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = cols.map((c) => ({ wch: Math.max(12, Math.ceil((c.label.length + 2) * 1.6)) }));

  const book = XLSX.utils.book_new();
  const sheetName = kindLabel.value.slice(0, 31);
  XLSX.utils.book_append_sheet(book, sheet, sheetName);

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(book, `统计报表-${kindLabel.value}-${stamp}.xlsx`);
  ElMessage.success('已导出 Excel');
}

onMounted(async () => {
  if (!projectStore.loaded) await projectStore.loadOptions();
  await load();
});
</script>
