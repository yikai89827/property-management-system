<template>
  <div>
    <van-nav-bar title="我的电子收据" left-arrow @click-left="$router.back()" />
    <van-pull-refresh v-model="refreshing" @refresh="load">
      <van-list v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
        <van-cell-group inset v-for="r in list" :key="r.orderNo" class="receipt-item" @click="$router.push(`/receipts/${r.orderNo}`)">
          <van-cell :title="r.orderNo" :label="`${r.projectName} · ${typeLabels[r.chargeType] ?? r.chargeType}`" is-link>
            <template #value>
              <span class="amount">{{ (r.receivedAmount / 100).toFixed(2) }} 元</span>
            </template>
          </van-cell>
          <van-cell :title="r.paidAt?.slice(0, 10) ?? '待确认'" :value="statusLabels[r.status] ?? r.status" />
        </van-cell-group>
      </van-list>
      <van-empty v-if="finished && list.length === 0" description="暂无历史收据" />
    </van-pull-refresh>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { http } from '@/api/request';

const typeLabels: Record<string, string> = { DELIVERY: '交房缴费', PROPERTY: '物业费', OTHER: '其他缴费' };
const statusLabels: Record<string, string> = { effective: '已生效', pending: '确认中', void: '已驳回' };
const list = ref<Record<string, any>[]>([]);
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const page = ref(1);

async function load() {
  if (refreshing.value) {
    list.value = [];
    page.value = 1;
    refreshing.value = false;
  }
  loading.value = true;
  try {
    const data = await http.get<never, { list: Record<string, any>[]; total: number }>('/owner/receipts', {
      params: { page: page.value, pageSize: 10 },
    });
    list.value.push(...data.list);
    if (list.value.length >= data.total) finished.value = true;
    page.value += 1;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.receipt-item { margin-top: 12px; }
.amount { color: #323233; font-weight: bold; }
</style>