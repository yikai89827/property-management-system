<template>
  <div class="result-page">
    <van-nav-bar title="缴费登记结果" />
    <div class="content">
      <van-icon name="clock-o" size="64" color="#ff976a" />
      <h3>待物业确认</h3>
      <van-cell-group inset>
        <van-cell title="单据编号" :value="String($route.query.orderNo ?? '')" />
        <van-cell title="金额" :value="`${$route.query.amount ?? '0.00'} 元`" />
      </van-cell-group>
      <p class="tip">一期收款登记流程说明：请尽快完成线下转账/支付，物业确认到账后缴费生效并生成电子收据（二期将支持实时支付结果）。</p>
      <van-button type="primary" block round @click="$router.replace('/receipts')">查看电子收据</van-button>
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.content { text-align: center; padding: 32px 16px; }
.tip { color: #969799; font-size: 13px; text-align: left; margin: 16px 0 24px; }
</style>