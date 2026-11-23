<template>
  <el-card>
    <template #header>交房缴费工作台</template>
    <el-form inline>
      <el-form-item label="项目">
        <el-select v-model="projectId" style="width: 200px">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="房号">
        <el-input v-model="roomNo" placeholder="如 1-101" style="width: 140px" @keyup.enter="preview" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="preview">查询应缴费信息</el-button>
      </el-form-item>
    </el-form>

    <template v-if="previewData">
      <el-descriptions title="客户信息" :column="4" border>
        <el-descriptions-item label="姓名">{{ previewData.customer.name }}</el-descriptions-item>
        <el-descriptions-item label="房号">{{ previewData.customer.roomNo }}</el-descriptions-item>
        <el-descriptions-item label="面积">{{ (previewData.customer.houseAreaFen / 100).toFixed(2) }}㎡</el-descriptions-item>
        <el-descriptions-item label="状态">{{ previewData.customer.houseStatusLabel }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="previewData.feeItems" border style="margin-top: 12px">
        <el-table-column label="费用项" width="130">
          <template #default="{ row }">{{ feeItemLabels[row.feeItemCode] }}</template>
        </el-table-column>
        <el-table-column prop="calcBasis" label="计算依据" />
        <el-table-column label="金额（元）" width="130" align="right">
          <template #default="{ row }">{{ (row.amount / 100).toFixed(2) }}</template>
        </el-table-column>
      </el-table>
      <div class="total">合计应交：<span>{{ (previewData.totalReceivable / 100).toFixed(2) }}</span> 元</div>

      <el-form inline style="margin-top: 16px">
        <el-form-item label="优惠类型">
          <el-select v-model="form.discountType" clearable style="width: 140px">
            <el-option v-for="(l, v) in discountLabels" :key="v" :label="l" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="优惠金额（元）">
          <el-input-number v-model="form.discountYuan" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="押金抵扣（元）">
          <el-input-number v-model="form.deductYuan" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="收款方式" required>
          <el-select v-model="form.paymentMethodCode" style="width: 140px">
            <el-option v-for="m in methods" :key="m.code" :label="m.name" :value="m.code" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" :loading="charging" @click="submit">提交缴费</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-dialog v-model="receiptVisible" title="缴费成功 - 收款单打印预览" width="780">
      <ReceiptPreview v-if="receipt" :order="receipt" :payer="receiptPayer" @close="receiptVisible = false" />
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { DISCOUNT_TYPE_LABELS, FEE_ITEM_LABELS } from '@pms/shared';
import { http } from '@/api/request';
import ReceiptPreview from './ReceiptPreview.vue';

const feeItemLabels = FEE_ITEM_LABELS;
const discountLabels = DISCOUNT_TYPE_LABELS;
const projects = ref<{ id: number; name: string }[]>([]);
const methods = ref<{ code: string; name: string }[]>([]);
const projectId = ref<number>();
const roomNo = ref('');
const loading = ref(false);
const charging = ref(false);
const previewData = ref<Record<string, any> | null>(null);
const receiptVisible = ref(false);
const receipt = ref<Record<string, any> | null>(null);
const receiptPayer = ref<Record<string, any>>({});
const form = reactive({ discountType: '', discountYuan: 0, deductYuan: 0, paymentMethodCode: 'CASH' });

async function preview() {
  if (!projectId.value || !roomNo.value) {
    ElMessage.warning('请选择项目并输入房号');
    return;
  }
  loading.value = true;
  try {
    previewData.value = await http.post<never, Record<string, any>>('/fees/preview/delivery', {
      projectId: String(projectId.value),
      roomNo: roomNo.value,
    });
  } catch {
    previewData.value = null;
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.paymentMethodCode) {
    ElMessage.warning('请选择收款方式');
    return;
  }
  charging.value = true;
  try {
    const data = await http.post<never, Record<string, any>>('/charges/delivery', {
      projectId: String(projectId.value),
      roomNo: roomNo.value,
      discountType: form.discountType || undefined,
      discountAmount: form.discountYuan > 0 ? Math.round(form.discountYuan * 100) : undefined,
      depositDeduct: form.deductYuan > 0 ? Math.round(form.deductYuan * 100) : undefined,
      paymentMethodCode: form.paymentMethodCode,
    });
    receipt.value = data;
    receiptPayer.value = {
      projectName: previewData.value?.customer ? (projects.value.find((p) => p.id === projectId.value)?.name ?? '') : '',
      customerName: previewData.value?.customer?.name,
      roomNo: previewData.value?.customer?.roomNo,
      houseStatusLabel: previewData.value?.customer?.houseStatusLabel,
      discountType: form.discountType || undefined,
      paymentMethodName: methods.value.find((m) => m.code === form.paymentMethodCode)?.name,
    };
    receiptVisible.value = true;
    ElMessage.success(`缴费成功，单据编号 ${data.orderNo}`);
    previewData.value = null;
    roomNo.value = '';
  } catch {
    // PMS-4001/4002/4003/4004 由拦截器回显
  } finally {
    charging.value = false;
  }
}

onMounted(async () => {
  const p = await http.get<never, { list: { id: number; name: string }[] }>('/projects', { params: { pageSize: 100 } });
  projects.value = p.list;
  projectId.value = p.list[0]?.id;
  methods.value = await http.get<never, { code: string; name: string }[]>('/payment-methods');
});
</script>

<style scoped>
.total { text-align: right; font-size: 16px; margin-top: 8px; }
.total span { color: #f56c6c; font-weight: bold; }
</style>