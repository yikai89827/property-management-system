<template>
  <div>
    <el-row :gutter="16">
      <el-col :span="8">
        <el-card>
          <template #header>快捷入口</template>
          <div class="quick-links">
            <el-button v-for="q in quickLinks" :key="q.path" type="primary" plain @click="$router.push(q.path)">
              {{ q.title }}
            </el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-card>
          <template #header>系统说明</template>
          <p>三端物业管理系统：业主端（扫码缴费 → 电子收据）、项目端（信息录入/缴费办理/统计）、公司管理端（权限/全项目统计）。</p>
          <p>支持多项目/多物业公司两级扩展，金额全程以整数（分）运算，历史收款单参数快照不回溯。</p>
          <p class="tip">初始账号 admin / admin123（公司管理员，全部权限）。</p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { PermissionCodes } from '@pms/shared';

const auth = useAuthStore();
const quickLinks = computed(() =>
  [
    { path: '/customers', title: '客户档案', permission: PermissionCodes.CUSTOMER_VIEW },
    { path: '/charging/delivery', title: '交房缴费', permission: PermissionCodes.CHARGE_DELIVERY_EXECUTE },
    { path: '/charging/property', title: '物业费续费', permission: PermissionCodes.CHARGE_PROPERTY_EXECUTE },
    { path: '/statistics', title: '统计报表', permission: PermissionCodes.STATISTIC_MONTHLY_VIEW },
  ].filter((q) => auth.hasPermission(q.permission)),
);
</script>

<style scoped>
.quick-links { display: flex; flex-wrap: wrap; gap: 12px; }
.tip { color: #909399; font-size: 12px; }
</style>