<template>
  <el-card>
    <template #header>其他费用缴费工作台</template>
    <el-form label-width="120px" style="max-width: 600px">
      <el-form-item label="项目" required>
        <el-select v-model="projectId">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="房号" required>
        <el-input v-model="roomNo" style="width: 200px" />
      </el-form-item>
      <el-form-item label="费用类别" required>
        <el-select v-model="feeCategoryCode" filterable placeholder="打墙费/车库管理费/电费/水费/广告费/服务费">
          <el-option v-for="c in categories" :key="c.code" :label="c.name" :value="c.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="费用金额（元）" required>
        <el-input-number v-model="amountYuan" :min="0.01" :precision="2" />
      </el-form-item>
      <el-form-item label="优惠金额（元）">
        <el-input-number v-model="discountYuan" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="收款方式" required>
        <el-select v-model="paymentMethodCode" style="width: 200px">
          <el-option v-for="m in methods" :key="m.code" :label="m.name" :value="m.code" />
        </el-select>
      </el-form-item>
      <el-form-item label="实收金额（元）">
        <span class="amount">{{ actual.toFixed(2) }}</span>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" size="large" :loading="charging" @click="submit">提交缴费</el-button>
      </el-form-item>
    </el-form>

    <el-dialog v-model="receiptVisible" title="缴费成功 - 收款单打印预览" width="780">
      <ReceiptPreview v-if="receipt" :order="receipt" :payer="receiptPayer" @close="receiptVisible = false" />
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRefs } from 'vue';
import { ElMessage } from 'element-plus';
import { http } from '@/api/request';
import ReceiptPreview from './ReceiptPreview.vue';

const projects = ref<{ id: number; name: string }[]>([]);
const categories = ref<{ code: string; name: string }[]>([]);
const methods = ref<{ code: string; name: string }[]>([]);
const form = reactive({
  projectId: undefined as number | undefined,
  roomNo: '',
  feeCategoryCode: '',
  amountYuan: 100,
  discountYuan: 0,
  paymentMethodCode: 'CASH',
});
const { projectId, roomNo, feeCategoryCode, amountYuan, discountYuan, paymentMethodCode } = toRefs(form);
const charging = ref(false);
const receiptVisible = ref(false);
const receipt = ref<Record<string, any> | null>(null);
const receiptPayer = ref<Record<string, any>>({});
const actual = computed(() => Math.max(0, amountYuan.value - discountYuan.value));

async function submit() {
  if (!projectId.value || !roomNo.value || !feeCategoryCode.value || amountYuan.value <= 0) {
    ElMessage.warning('请选择费用类别并填写房号与费用金额');
    return;
  }
  charging.value = true;
  try {
    const data = await http.post<never, Record<string, any>>('/charges/other', {
      projectId: String(projectId.value),
      roomNo: roomNo.value,
      feeCategoryCode: feeCategoryCode.value,
      amount: Math.round(amountYuan.value * 100),
      discountAmount: discountYuan.value > 0 ? Math.round(discountYuan.value * 100) : undefined,
      paymentMethodCode: paymentMethodCode.value,
    });
    receipt.value = data;
    receiptPayer.value = {
      projectName: projects.value.find((p) => p.id === projectId.value)?.name ?? '',
      paymentMethodName: methods.value.find((m) => m.code === paymentMethodCode.value)?.name,
    };
    receiptVisible.value = true;
    ElMessage.success(`缴费成功，单据编号 ${data.orderNo}`);
    roomNo.value = '';
    amountYuan.value = 100;
    discountYuan.value = 0;
  } catch {
    // 拦截器提示
  } finally {
    charging.value = false;
  }
}

onMounted(async () => {
  const p = await http.get<never, { list: { id: number; name: string }[] }>('/projects', { params: { pageSize: 100 } });
  projects.value = p.list;
  projectId.value = p.list[0]?.id;
  categories.value = await http.get<never, { code: string; name: string }[]>('/fee-categories');
  methods.value = await http.get<never, { code: string; name: string }[]>('/payment-methods');
});
</script>

<style scoped>
.amount { color: #f56c6c; font-weight: bold; font-size: 16px; }
</style>