<template>
  <el-card>
    <template #header>收款单查询</template>
    <el-form inline>
      <el-form-item label="时间范围">
        <el-date-picker v-model="range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" />
      </el-form-item>
      <el-form-item label="缴费类型">
        <el-select v-model="chargeType" clearable style="width: 150px">
          <el-option label="交房缴费" value="DELIVERY" />
          <el-option label="物业费续费" value="PROPERTY" />
          <el-option label="其他缴费" value="OTHER" />
        </el-select>
      </el-form-item>
      <el-form-item label="房号">
        <el-input v-model="roomNo" style="width: 120px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load">查询</el-button>
      </el-form-item>
    </el-form>
    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="orderNo" label="单据编号" width="170" />
      <el-table-column prop="projectName" label="项目名称" />
      <el-table-column prop="customerName" label="姓名" width="90" />
      <el-table-column prop="roomNo" label="房号" width="90" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{ typeLabels[row.chargeType] ?? row.chargeType }}</template>
      </el-table-column>
      <el-table-column label="应交（元）" width="110" align="right">
        <template #default="{ row }">{{ (row.receivableAmount / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="优惠（元）" width="100" align="right">
        <template #default="{ row }">{{ (row.discountAmount / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="实收（元）" width="110" align="right">
        <template #default="{ row }">{{ (row.receivedAmount / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="payeeName" label="收款人" width="100" />
      <el-table-column label="收款日期" width="170">
        <template #default="{ row }">{{ row.paidAt?.slice(0, 19).replace('T', ' ') }}</template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button link type="primary" @click="showDetail(row.orderNo)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
      style="margin-top: 12px"
    />

    <el-drawer v-model="drawerVisible" title="收款单详情（含开单时刻快照）" size="600">
      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="单据编号" :span="2">{{ detail.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="项目名称">{{ detail.projectName }}</el-descriptions-item>
          <el-descriptions-item label="房号">{{ detail.roomNo }}</el-descriptions-item>
        </el-descriptions>
        <table class="mini">
          <tr v-for="(i, k) in detail.items" :key="k">
            <td>{{ i.calcBasis }}</td>
            <td class="num">{{ (i.amount / 100).toFixed(2) }}</td>
          </tr>
        </table>
        <p class="remark">{{ detail.remark }}</p>
        <ReceiptPrint :order="detail" :payer="detail.payerSnapshot ?? {}" />
      </template>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http } from '@/api/request';
import ReceiptPreview from './ReceiptPreview.vue';

const ReceiptPrint = ReceiptPreview;

const typeLabels: Record<string, string> = { DELIVERY: '交房缴费', PROPERTY: '物业费续费', OTHER: '其他缴费' };
const list = ref<Record<string, any>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const range = ref<[string, string] | null>(null);
const chargeType = ref('');
const roomNo = ref('');
const drawerVisible = ref(false);
const detail = ref<Record<string, any> | null>(null);

async function load() {
  loading.value = true;
  try {
    const data = await http.get<never, { list: Record<string, any>[]; total: number }>('/charges', {
      params: {
        startTime: range.value?.[0],
        endTime: range.value?.[1],
        chargeType: chargeType.value || undefined,
        roomNo: roomNo.value || undefined,
        page: page.value,
        pageSize,
      },
    });
    list.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

async function showDetail(orderNo: string) {
  detail.value = await http.get<never, Record<string, any>>(`/charges/${orderNo}`);
  drawerVisible.value = true;
}

onMounted(load);
</script>

<style scoped>
.mini { width: 100%; border-collapse: collapse; margin-top: 12px; }
.mini td { border: 1px solid #ebeef5; padding: 8px; font-size: 13px; }
.num { text-align: right; width: 120px; }
.remark { color: #909399; font-size: 12px; margin-top: 12px; }
</style>