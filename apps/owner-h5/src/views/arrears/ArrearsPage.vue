<template>
  <div>
    <van-nav-bar title="我的欠费" left-text="重新验证" @click-left="reVerify" />
    <div v-if="arrears" class="content">
      <van-cell-group inset v-if="arrears.remainingMonths > 0">
        <van-cell title="计费起始月" :value="arrears.feeStartMonth" />
        <van-cell title="计费截止月" :value="arrears.feeEndMonth ?? '—'" />
        <van-cell title="累计计费月数" :value="`${arrears.totalBillableMonths} 个月`" />
        <van-cell title="累计已缴费月数" :value="`${arrears.paidMonths} 个月`" />
        <van-cell title="累计欠费月份" :value="`${arrears.remainingMonths} 个月`" />
        <van-cell title="欠费金额" :value="`${(arrears.arrearsAmount / 100).toFixed(2)} 元`" value-class="amount" />
      </van-cell-group>
      <van-empty v-else description="您的物业费已缴清，感谢配合" image="success" />

      <div class="actions">
        <van-button type="primary" block round :disabled="arrears.remainingMonths === 0" @click="$router.push('/charge')">
          去缴费
        </van-button>
        <van-button type="default" block round plain style="margin-top: 12px" @click="$router.push('/receipts')">
          查看电子收据
        </van-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '@/api/request';

const router = useRouter();
const arrears = ref<Record<string, any> | null>(null);

function reVerify() {
  localStorage.removeItem('pms_owner_token');
  router.push('/verify');
}

onMounted(async () => {
  arrears.value = await http.get<never, Record<string, any>>('/owner/arrears');
});
</script>

<style scoped>
.content { padding: 16px; }
.amount { color: #ee0a24; font-weight: bold; }
.actions { margin-top: 24px; }
</style>