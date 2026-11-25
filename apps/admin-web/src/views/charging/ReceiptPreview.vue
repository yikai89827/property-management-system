<template>
  <div class="receipt-preview">
    <h2 class="title">收款单</h2>
    <div class="grid">
      <div>项目名称：{{ payer.projectName }}</div>
      <div>姓　　名：{{ payer.customerName }}</div>
      <div>房　　号：{{ payer.roomNo }}</div>
      <div>房屋状态：{{ payer.houseStatusLabel ?? payer.houseStatus }}</div>
      <div class="full">单据编号：{{ order.orderNo }}</div>
    </div>
    <table class="items">
      <thead>
        <tr>
          <th>费用项</th>
          <th>计算依据</th>
          <th>金额（元）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, i) in order.items" :key="i">
          <td>{{ feeItemLabels[item.feeItemCode] ?? item.feeItemCode }}</td>
          <td class="basis">{{ item.calcBasis }}</td>
          <td class="num">{{ (item.amount / 100).toFixed(2) }}</td>
        </tr>
        <tr v-if="billingInfo">
          <td>计费区间</td>
          <td class="basis">{{ billingInfo.feeStartMonth }} 至 {{ billingInfo.feeEndMonth }}（{{ months }}个月，单价 {{ (billingInfo.unitPriceSnapshot / 100).toFixed(2) }}元/㎡/月）</td>
          <td class="num">—</td>
        </tr>
      </tbody>
    </table>
    <div class="grid">
      <div>应交金额：{{ (order.receivableAmount / 100).toFixed(2) }} 元</div>
      <div>优惠类型：{{ payer.discountType ? discountLabels[payer.discountType] ?? payer.discountType : '—' }}</div>
      <div>优惠金额：{{ (order.discountAmount / 100).toFixed(2) }} 元</div>
      <div>押金抵扣：{{ (order.depositDeduct / 100).toFixed(2) }} 元</div>
      <div class="strong">实收金额：{{ (order.receivedAmount / 100).toFixed(2) }} 元</div>
      <div>收款方式：{{ payer.paymentMethodName ?? payer.paymentMethodCode }}</div>
      <div>收 款 人：{{ payer.payee ?? order.payeeName }}</div>
      <div>收款日期：{{ formatDateTime(order.paidAt) }}</div>
    </div>
    <p class="remark">{{ order.remark }}</p>
    <div class="actions no-print">
      <el-button type="primary" @click="print">打印</el-button>
      <el-button @click="$emit('close')">关闭</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DISCOUNT_TYPE_LABELS, FEE_ITEM_LABELS } from '@pms/shared';
import { formatDateTime } from '@/utils/format';

const props = defineProps<{
  order: {
    orderNo: string;
    items: { feeItemCode: string; amount: number; calcBasis: string }[];
    receivableAmount: number;
    discountAmount: number;
    depositDeduct: number;
    receivedAmount: number;
    paidAt?: string;
    payeeName?: string;
    remark: string;
  };
  payer: Record<string, any>;
  billingInfo?: Record<string, any> | null;
}>();

defineEmits(['close']);

const feeItemLabels = FEE_ITEM_LABELS;
const discountLabels = DISCOUNT_TYPE_LABELS;
const months = computed(() => props.billingInfo?.months ?? '');

function print() {
  window.print();
}
</script>

<style scoped>
.receipt-preview { background: #fff; padding: 24px; max-width: 720px; margin: 0 auto; border: 1px solid #dcdfe6; }
.title { text-align: center; letter-spacing: 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 12px 0; font-size: 14px; }
.full { grid-column: span 2; }
.strong { font-weight: bold; }
.items { width: 100%; border-collapse: collapse; margin: 12px 0; }
.items th, .items td { border: 1px solid #333; padding: 6px 10px; font-size: 14px; text-align: left; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.basis { color: #606266; font-size: 12px; }
.remark { margin-top: 16px; padding: 8px; border-top: 1px dashed #999; color: #909399; font-size: 12px; }
.actions { margin-top: 16px; text-align: right; }
@media print {
  .no-print { display: none; }
}
</style>