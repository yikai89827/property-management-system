<template>
  <el-card>
    <template #header>统计报表（八类）</template>
    <el-form inline>
      <el-form-item label="统计类型">
        <el-select v-model="kind" style="width: 140px" @change="load">
          <el-option label="月度统计" value="monthly" />
          <el-option label="年度统计" value="yearly" />
          <el-option label="分类统计" value="category" />
          <el-option label="欠费统计" value="arrears" />
          <el-option label="应收统计" value="receivable" />
          <el-option label="实收统计" value="received" />
          <el-option label="优惠统计" value="discount" />
          <el-option label="押金统计" value="deposit" />
        </el-select>
      </el-form-item>
      <el-form-item label="年度" v-if="kind === 'yearly'">
        <el-date-picker v-model="year" type="year" value-format="YYYY" :clearable="false" />
      </el-form-item>
      <el-form-item label="时间范围" v-if="kind !== 'yearly' && kind !== 'arrears'">
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load">查询</el-button>
        <el-button @click="exportCsv">导出 CSV</el-button>
      </el-form-item>
    </el-form>

    <template v-if="kind === 'monthly' || kind === 'yearly'">
      <el-table :data="summaryRows" border>
        <el-table-column prop="label" label="期间" />
        <el-table-column label="应收（元）" align="right">
          <template #default="{ row }">{{ (row.receivableAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="实收（元）" align="right">
          <template #default="{ row }">{{ (row.receivedAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="优惠（元）" align="right">
          <template #default="{ row }">{{ (row.discountAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="押金（元）" align="right">
          <template #default="{ row }">{{ (row.depositAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="orderCount" label="单据数" width="90" align="right" />
      </el-table>
    </template>

    <template v-else-if="kind === 'category'">
      <el-table :data="dataList" border>
        <el-table-column prop="category" label="费用类别" />
        <el-table-column label="应收（元）" align="right">
          <template #default="{ row }">{{ (row.receivableAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="实收（元）" align="right">
          <template #default="{ row }">{{ (row.receivedAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="优惠（元）" align="right">
          <template #default="{ row }">{{ (row.discountAmount / 100).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="orderCount" label="单据数" width="90" align="right" />
      </el-table>
    </template>

    <template v-else-if="kind === 'arrears'">
      <el-table :data="dataList" border>
        <el-table-column prop="projectName" label="项目" />
        <el-table-column prop="roomNo" label="房号" width="110" />
        <el-table-column prop="customerName" label="业主" width="110" />
        <el-table-column prop="arrearsMonths" label="欠费月数" width="100" align="right" />
        <el-table-column label="欠费金额（元）" align="right">
          <template #default="{ row }">{{ (row.arrearsAmount / 100).toFixed(2) }}</template>
        </el-table-column>
      </el-table>
    </template>

    <template v-else>
      <el-table :data="dataList" border>
        <el-table-column v-for="col in dynamicCols" :key="col.key" :prop="col.key" :label="col.label" />
      </el-table>
    </template>

    <el-empty v-if="loaded && dataList.length === 0 && summaryRows.length === 0" description="该周期内暂无收费数据" />
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { http } from '@/api/request';

const kind = ref('monthly');
const year = ref(String(new Date().getFullYear()));
const range = ref<[string, string] | null>(null);
const dataList = ref<Record<string, any>[]>([]);
const summaryRows = ref<Record<string, any>[]>([]);
const loaded = ref(false);

const dynamicCols = computed(() => {
  const yuan = (label: string) => ({
    label,
    key: label.replace(/[（）]/g, ''),
  });
  if (kind.value === 'receivable') return [yuan('单据编号'), yuan('应收（元）'), yuan('优惠（元）'), yuan('实收（元）')];
  if (kind.value === 'received') return [yuan('单据编号'), yuan('实收（元）'), yuan('收款日期')];
  if (kind.value === 'discount') return [yuan('单据编号'), yuan('优惠类型'), yuan('优惠（元）')];
  return [yuan('项目编号'), yuan('押金（元）')];
});

async function load() {
  const params: Record<string, any> = {};
  if (kind.value === 'yearly') params.year = year.value;
  if (range.value && kind.value !== 'yearly' && kind.value !== 'arrears') {
    params.startTime = range.value[0];
    params.endTime = range.value[1];
  }
  const res = await http.get<never, Record<string, any>>(`/statistics/${kind.value}`, { params });
  loaded.value = true;
  if (kind.value === 'monthly') {
    summaryRows.value = [{ label: '本期合计', ...res }];
    dataList.value = [];
  } else if (kind.value === 'yearly') {
    summaryRows.value = [
      ...(res.months ?? []).map((m: Record<string, any>) => ({ label: m.month, ...m.summary })),
      { label: `${res.year} 合计`, ...res.total },
    ];
    dataList.value = [];
  } else {
    dataList.value = Array.isArray(res) ? res : [];
    summaryRows.value = [];
  }
}

function exportCsv() {
  const rows = summaryRows.value.length > 0 ? summaryRows.value : dataList.value;
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => String(r[h] ?? '')).join(',')),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.download = `statistics-${kind.value}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
}

onMounted(load);
</script>