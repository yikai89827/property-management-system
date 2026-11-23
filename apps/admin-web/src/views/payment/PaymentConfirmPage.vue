<template>
  <el-card>
    <template #header>
      收款确认工作台（业主端申报缴费登记 → 确认到账 / 驳回）
    </template>
    <el-radio-group v-model="statusFilter" @change="load" style="margin-bottom: 12px">
      <el-radio-button value="pending">待确认</el-radio-button>
      <el-radio-button value="success">已确认</el-radio-button>
      <el-radio-button value="failed">已驳回</el-radio-button>
    </el-radio-group>
    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="id" label="记录号" width="80" />
      <el-table-column prop="orderNo" label="单据编号" width="170" />
      <el-table-column prop="customerName" label="业主" width="90" />
      <el-table-column prop="roomNo" label="房号" width="90" />
      <el-table-column label="金额（元）" width="110" align="right">
        <template #default="{ row }">{{ (row.amount / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="申报方式" width="110">
        <template #default="{ row }">{{ methodLabels[row.methodCode] ?? row.methodCode }}</template>
      </el-table-column>
      <el-table-column prop="channelTradeNo" label="申报流水号" width="170" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'pending' ? 'warning' : row.status === 'success' ? 'success' : 'danger'" size="small">
            {{ statusLabels[row.status] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-popconfirm title="确认该笔缴费已到账？确认后核销欠费并生成电子收据。" confirm-button-text="确认" cancel-button-text="取消" @confirm="confirmRecord(row.id)">
              <template #reference>
                <el-button link type="primary">确认到账</el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm title="驳回该笔登记？月段将释放，业主可重新发起。" confirm-button-text="驳回" cancel-button-text="取消" @confirm="rejectRecord(row.id)">
              <template #reference>
                <el-button link type="danger">驳回</el-button>
              </template>
            </el-popconfirm>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { PAYMENT_STATUS_LABELS } from '@pms/shared';
import { http } from '@/api/request';

const methodLabels: Record<string, string> = { CASH: '现金', BANK_TRANSFER: '银行转账', MOBILE_PAY: '移动支付', POS: 'POS', CHEQUE: '支票' };
const statusLabels = PAYMENT_STATUS_LABELS as Record<string, string>;
const list = ref<Record<string, any>[]>([]);
const loading = ref(false);
const statusFilter = ref('pending');

async function load() {
  loading.value = true;
  try {
    const data = await http.get<never, { list: Record<string, any>[] }>('/payments/records', {
      params: { status: statusFilter.value },
    });
    list.value = data.list;
  } finally {
    loading.value = false;
  }
}

async function confirmRecord(id: number) {
  await http.post(`/payments/records/${id}/confirm`);
  ElMessage.success('已确认到账，欠费已核销，电子收据已生成');
  await load();
}

async function rejectRecord(id: number) {
  await http.post(`/payments/records/${id}/reject`, { reason: '未查询到到账记录' });
  ElMessage.success('已驳回，月段已释放');
  await load();
}

onMounted(load);
</script>