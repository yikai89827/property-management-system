<template>
  <div>
    <van-nav-bar title="电子收据" left-arrow @click-left="$router.back()" />
    <div v-if="detail" class="receipt">
      <h2 class="title">收款单（电子收据）</h2>
      <van-cell-group inset>
        <van-cell title="单据编号" :value="detail.orderNo" />
        <van-cell title="项目名称" :value="detail.projectName" />
        <van-cell title="缴费类型" :value="typeLabels[detail.chargeType] ?? detail.chargeType" />
        <van-cell title="应交金额" :value="`${(detail.receivableAmount / 100).toFixed(2)} 元`" />
        <van-cell title="优惠金额" :value="`${(detail.discountAmount / 100).toFixed(2)} 元`" />
        <van-cell title="押金抵扣" :value="`${(detail.depositDeduct / 100).toFixed(2)} 元`" />
        <van-cell title="实收金额" :value="`${(detail.receivedAmount / 100).toFixed(2)} 元`" value-class="strong" />
        <van-cell title="状态" :value="statusLabels[detail.status] ?? detail.status" />
        <van-cell title="收款日期" :value="detail.paidAt?.slice(0, 19).replace('T', ' ') ?? '—'" />
      </van-cell-group>
      <div v-for="(i, k) in detail.items" :key="k" class="item">
        <p class="basis">{{ i.calcBasis }}</p>
      </div>
      <p class="remark">{{ detail.remark }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '@/api/request';

const route = useRoute();
const detail = ref<Record<string, any> | null>(null);
const typeLabels: Record<string, string> = { DELIVERY: '交房缴费', PROPERTY: '物业费', OTHER: '其他缴费' };
const statusLabels: Record<string, string> = { effective: '已生效', pending: '确认中', void: '已驳回' };

onMounted(async () => {
  detail.value = await http.get<never, Record<string, any>>(`/owner/receipts/${route.params.orderNo}`);
});
</script>

<style scoped>
.receipt { padding: 16px; }
.title { text-align: center; font-size: 18px; }
.item { padding: 0 16px; }
.basis { font-size: 12px; color: #969799; }
.strong { color: #ee0a24; font-weight: bold; }
.remark { color: #969799; font-size: 12px; padding: 8px 16px; border-top: 1px dashed #ebedf0; margin-top: 12px; }
</style>