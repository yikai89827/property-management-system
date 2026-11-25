<template>
  <el-card>
    <template #header>交房缴费工作台</template>
    <el-form inline>
      <el-form-item label="当前项目">
        <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
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
        <el-descriptions-item label="物业费起始">{{ previewData.customer.feeStartDate ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="装修时间">{{ previewData.customer.decorateDate ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="计费区间">{{ previewData.feeStartMonth }} ~ {{ previewData.feeEndMonth }}</el-descriptions-item>
        <el-descriptions-item label="欠费月数">{{ previewData.arrearsMonths }}</el-descriptions-item>
        <el-descriptions-item label="空置优惠资格" :span="4">
          <el-tag :type="previewData.customer.vacantEligible ? 'success' : 'info'">
            {{ previewData.customer.vacantEligible ? '有有效装修报备，可选空置优惠' : '无装修报备，不可选空置优惠' }}
          </el-tag>
        </el-descriptions-item>
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
import { useCurrentProject } from '@/composables/useCurrentProject';
import ReceiptPreview from './ReceiptPreview.vue';

const feeItemLabels = FEE_ITEM_LABELS;
const discountLabels = DISCOUNT_TYPE_LABELS;
const { projectName, requireProjectId } = useCurrentProject({
  onChange: () => {
    previewData.value = null;
  },
});
const methods = ref<{ code: string; name: string }[]>([]);
const roomNo = ref('');
const loading = ref(false);
const charging = ref(false);
const previewData = ref<Record<string, any> | null>(null);
const receiptVisible = ref(false);
const receipt = ref<Record<string, any> | null>(null);
const receiptPayer = ref<Record<string, any>>({});
const form = reactive({ discountType: '', discountYuan: 0, deductYuan: 0, paymentMethodCode: 'CASH' });

async function preview() {
  const pid = requireProjectId();
  if (!pid || !roomNo.value) {
    if (pid && !roomNo.value) ElMessage.warning('请输入房号');
    return;
  }
  loading.value = true;
  try {
    previewData.value = await http.post<never, Record<string, any>>('/fees/preview/delivery', {
      projectId: String(pid),
      roomNo: roomNo.value,
    });
  } catch {
    previewData.value = null;
  } finally {
    loading.value = false;
  }
}

async function submit() {
  const pid = requireProjectId();
  if (!pid) return;
  if (!form.paymentMethodCode) {
    ElMessage.warning('请选择收款方式');
    return;
  }
  charging.value = true;
  try {
    const data = await http.post<never, Record<string, any>>('/charges/delivery', {
      projectId: String(pid),
      roomNo: roomNo.value,
      discountType: form.discountType || undefined,
      discountAmount: form.discountYuan > 0 ? Math.round(form.discountYuan * 100) : undefined,
      depositDeduct: form.deductYuan > 0 ? Math.round(form.deductYuan * 100) : undefined,
      paymentMethodCode: form.paymentMethodCode,
    });
    receipt.value = data;
    receiptPayer.value = {
      projectName: projectName.value,
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
  methods.value = (await http.get<never, { code: string; name: string; enabled?: boolean }[]>('/payment-methods')).filter(
    (m) => m.enabled !== false,
  );
});
</script>

<style scoped>
.total { text-align: right; font-size: 16px; margin-top: 8px; }
.total span { color: #f56c6c; font-weight: bold; }
</style>
