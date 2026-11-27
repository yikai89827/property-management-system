<template>
  <el-card>
    <template #header>物业费续费工作台</template>
    <el-form inline>
      <el-form-item label="当前项目">
        <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
      </el-form-item>
      <el-form-item label="房号">
        <el-input v-model="roomNo" style="width: 140px" @keyup.enter="preview" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="preview">查询计费信息</el-button>
      </el-form-item>
    </el-form>

    <template v-if="billingInfo">
      <el-descriptions title="计费信息卡" :column="4" border>
        <el-descriptions-item label="业主">{{ customerInfo?.name ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="装修时间">{{ customerInfo?.decorateDate ?? '—' }}</el-descriptions-item>
        <el-descriptions-item label="空置优惠资格">
          <el-tag :type="customerInfo?.vacantEligible ? 'success' : 'warning'" size="small">
            {{ customerInfo?.vacantEligible ? '未装修可选用' : '已装修不可用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="押金抵扣">
          <el-tag :type="customerInfo?.depositDeductAllowed ? 'success' : 'info'" size="small">
            {{ customerInfo?.depositDeductAllowed ? '已报备可抵扣' : '未报备不可抵扣' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="计费总区间">{{ billingInfo.billableFromMonth }} ~ {{ billingInfo.billableToMonth }}</el-descriptions-item>
        <el-descriptions-item label="本次起缴月">{{ billingInfo.feeStartMonth }}</el-descriptions-item>
        <el-descriptions-item label="本次截止月">{{ billingInfo.feeEndMonth }}</el-descriptions-item>
        <el-descriptions-item label="累计计费月数">{{ billingInfo.totalBillableMonths }}</el-descriptions-item>
        <el-descriptions-item label="已缴费月数">{{ billingInfo.paidMonths }}</el-descriptions-item>
        <el-descriptions-item label="累计欠费月份">
          <el-tag :type="billingInfo.remainingMonths > 0 ? 'danger' : 'success'">{{ billingInfo.remainingMonths }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="欠费金额">
          <span class="amount">{{ ((billingInfo.arrearsAmount ?? 0) / 100).toFixed(2) }} 元</span>
        </el-descriptions-item>
        <el-descriptions-item label="房屋面积">{{ (billingInfo.houseAreaSnapshot / 100).toFixed(2) }}㎡</el-descriptions-item>
        <el-descriptions-item label="单价">{{ (billingInfo.unitPriceSnapshot / 100).toFixed(2) }} 元/㎡/月</el-descriptions-item>
        <el-descriptions-item label="本次应交">
          <span class="amount">{{ (billingInfo.receivableAmount / 100).toFixed(2) }} 元</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-form inline style="margin-top: 16px">
        <el-form-item label="续费月数" required>
          <el-input-number v-model="months" :min="1" :max="billingInfo.remainingMonths" />
        </el-form-item>
        <el-form-item label="起缴月">
          <el-date-picker v-model="startMonth" type="month" value-format="YYYY-MM" :clearable="false" />
        </el-form-item>
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
          <el-button type="primary" size="large" :loading="charging" @click="submit">提交续费</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-dialog v-model="receiptVisible" title="续费成功 - 收款单打印预览" width="780">
      <ReceiptPreview v-if="receipt" :order="receipt" :payer="receiptPayer" :billing-info="receiptBilling" @close="receiptVisible = false" />
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { DISCOUNT_TYPE_LABELS } from '@pms/shared';
import { http } from '@/api/request';
import { useCurrentProject } from '@/composables/useCurrentProject';
import ReceiptPreview from './ReceiptPreview.vue';

const discountLabels = DISCOUNT_TYPE_LABELS;
const { projectName, requireProjectId } = useCurrentProject({
  onChange: () => {
    billingInfo.value = null;
    customerInfo.value = null;
  },
});
const methods = ref<{ code: string; name: string }[]>([]);
const roomNo = ref('');
const loading = ref(false);
const charging = ref(false);
const billingInfo = ref<Record<string, any> | null>(null);
const customerInfo = ref<Record<string, any> | null>(null);
const months = ref(1);
const startMonth = ref('');
const receiptVisible = ref(false);
const receipt = ref<Record<string, any> | null>(null);
const receiptPayer = ref<Record<string, any>>({});
const receiptBilling = ref<Record<string, any> | null>(null);
const form = reactive({ discountType: '', discountYuan: 0, deductYuan: 0, paymentMethodCode: 'CASH' });

async function preview() {
  const pid = requireProjectId();
  if (!pid || !roomNo.value) {
    if (pid && !roomNo.value) ElMessage.warning('请输入房号');
    return;
  }
  loading.value = true;
  try {
    const data = await http.post<never, { customer: Record<string, any>; billingInfo: Record<string, any> }>('/fees/preview/property', {
      projectId: String(pid),
      roomNo: roomNo.value,
    });
    customerInfo.value = data.customer;
    billingInfo.value = data.billingInfo;
    months.value = data.billingInfo.remainingMonths;
    startMonth.value = data.billingInfo.feeStartMonth;
  } catch {
    billingInfo.value = null;
    customerInfo.value = null;
  } finally {
    loading.value = false;
  }
}

async function submit() {
  const pid = requireProjectId();
  if (!pid) return;
  if (!months.value || !startMonth.value || !form.paymentMethodCode) {
    ElMessage.warning('请填写续费月数、起缴月与收款方式');
    return;
  }
  charging.value = true;
  try {
    const data = await http.post<never, Record<string, any>>('/charges/property', {
      projectId: String(pid),
      roomNo: roomNo.value,
      months: months.value,
      startMonth: startMonth.value,
      discountType: form.discountType || undefined,
      discountAmount: form.discountYuan > 0 ? Math.round(form.discountYuan * 100) : undefined,
      depositDeduct: form.deductYuan > 0 ? Math.round(form.deductYuan * 100) : undefined,
      paymentMethodCode: form.paymentMethodCode,
    });
    receipt.value = data;
    receiptBilling.value = (data as Record<string, any>).billingInfo ?? billingInfo.value;
    receiptPayer.value = {
      projectName: projectName.value,
      discountType: form.discountType || undefined,
      paymentMethodName: methods.value.find((m) => m.code === form.paymentMethodCode)?.name,
    };
    receiptVisible.value = true;
    ElMessage.success(`续费成功，单据编号 ${data.orderNo}`);
    billingInfo.value = null;
    customerInfo.value = null;
    roomNo.value = '';
  } catch {
    // PMS-4005 已缴清 / PMS-4006 月数不合法 等由拦截器回显
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
.amount { color: #f56c6c; font-weight: bold; }
</style>
