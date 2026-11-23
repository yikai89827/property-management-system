<template>
  <div>
    <van-nav-bar title="物业费缴费" left-arrow @click-left="$router.back()" />
    <div v-if="arrears" class="content">
      <van-cell-group inset>
        <van-cell title="剩余应交月数" :value="`${arrears.remainingMonths} 个月`" />
        <van-cell title="最早未缴月" :value="arrears.feeStartMonth" />
        <van-field v-model="months" type="digit" label="缴纳月数" placeholder="不超过剩余应交月数" />
        <van-field name="picker" label="申报付款方式" :model-value="methodName" is-link readonly placeholder="选择" @click="showPicker = true" />
        <van-field v-model="tradeNo" label="转账流水号" placeholder="选填，便于物业核对" />
      </van-cell-group>

      <van-popup v-model:show="showPicker" position="bottom" round>
        <van-picker
          :columns="methodColumns"
          @confirm="onMethodPick"
          @cancel="showPicker = false"
        />
        <div v-if="methodColumns.length === 0" class="empty-methods">暂无可用付款方式，请联系物业配置</div>
      </van-popup>

      <div class="pay-amount">
        预计缴纳金额：<span>{{ payAmount }}</span> 元
      </div>
      <van-button type="primary" block round :loading="submitting" @click="submit">提交缴费登记</van-button>
      <van-notice-bar wrapable text="一期收款登记模式：提交后由物业确认到账，确认后生效并生成电子收据；驳回后月段释放可重新发起。" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { http } from '@/api/request';

const router = useRouter();
const arrears = ref<Record<string, any> | null>(null);
const methods = ref<{ code: string; name: string }[]>([]);
const methodColumns = computed(() => methods.value.map((m) => ({ text: m.name, value: m.code })));
const showPicker = ref(false);
const methodName = ref('');
const methodCode = ref('');
const months = ref('1');
const tradeNo = ref('');
const submitting = ref(false);

const payAmount = computed(() => {
  const m = Number(months.value || 0);
  if (!arrears.value || m <= 0) return '0.00';
  return ((arrears.value.arrearsAmount / arrears.value.remainingMonths) * m / 100).toFixed(2);
});

/** Vant 4 Picker confirm 参数为 selectedOptions / selectedValues */
function onMethodPick(payload: {
  selectedOptions: Array<{ text?: string; value?: string | number }>;
  selectedValues: Array<string | number>;
}) {
  const opt = payload.selectedOptions?.[0];
  const code = String(opt?.value ?? payload.selectedValues?.[0] ?? '');
  const name = String(opt?.text ?? '');
  if (!code) {
    showToast('请选择申报付款方式');
    return;
  }
  methodName.value = name || code;
  methodCode.value = code;
  showPicker.value = false;
}

async function submit() {
  const m = Number(months.value);
  if (!m || m <= 0) {
    showToast('请填写缴纳月数');
    return;
  }
  if (arrears.value && m > arrears.value.remainingMonths) {
    showToast('缴纳月数不能超过剩余应交月数');
    return;
  }
  if (!methodCode.value) {
    showToast('请选择申报付款方式');
    return;
  }
  submitting.value = true;
  try {
    const data = await http.post<never, Record<string, any>>('/owner/charges/property', {
      months: m,
      startMonth: arrears.value?.feeStartMonth ?? '',
      declaredPaymentMethodCode: methodCode.value,
      declaredTradeNo: tradeNo.value || undefined,
    });
    router.push({ path: '/charge/result', query: { orderNo: data.orderNo, amount: (data.amount / 100).toFixed(2) } });
  } catch {
    // PMS-5002 重复支付拦截等由拦截器提示
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  arrears.value = await http.get<never, Record<string, any>>('/owner/arrears');
  months.value = String(arrears.value?.remainingMonths ?? 1);
  methods.value = (await http.get<never, { code: string; name: string }[]>('/owner/payment-methods')).filter(
    (m) => m.code !== 'CASH',
  );
});
</script>

<style scoped>
.content { padding: 16px; }
.pay-amount { margin: 16px 0; font-size: 15px; }
.pay-amount span { color: #ee0a24; font-weight: bold; font-size: 20px; }
.empty-methods { padding: 24px; text-align: center; color: #969799; font-size: 14px; }
</style>