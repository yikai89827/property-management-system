<template>
  <div v-if="detail">
    <el-page-header title="返回客户列表" @back="$router.back()" :content="`客户详情：${detail.name}（${detail.roomNo}）`" />
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="12">
        <el-card>
          <template #header>档案信息（敏感字段脱敏展示）</template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="姓名">{{ detail.name }}</el-descriptions-item>
            <el-descriptions-item label="住户类型">{{ residentLabels[detail.residentType] ?? detail.residentType }}</el-descriptions-item>
            <el-descriptions-item label="所属项目">{{ detail.projectName || detail.projectId }}</el-descriptions-item>
            <el-descriptions-item label="房号">{{ detail.roomNo }}</el-descriptions-item>
            <el-descriptions-item label="电话">{{ detail.phoneMasked }}</el-descriptions-item>
            <el-descriptions-item label="身份证号">{{ detail.idCardMasked }}</el-descriptions-item>
            <el-descriptions-item label="房屋面积">{{ (detail.houseAreaFen / 100).toFixed(2) }} ㎡</el-descriptions-item>
            <el-descriptions-item label="房屋状态">{{ statusLabels[detail.houseStatus] ?? detail.houseStatus }}</el-descriptions-item>
            <el-descriptions-item label="物业费起始">{{ detail.feeStartDate }}</el-descriptions-item>
            <el-descriptions-item label="交房时间">{{ detail.deliveryDate?.slice(0, 10) ?? '未交房' }}</el-descriptions-item>
            <el-descriptions-item label="合同签约" :span="2">{{ detail.contractDate ?? '—' }}</el-descriptions-item>
          </el-descriptions>
          <template v-if="detail.relatedProperties?.length">
            <el-divider>同一身份证下的其他房源（跨项目）</el-divider>
            <el-table :data="detail.relatedProperties" size="small" border>
              <el-table-column prop="projectName" label="项目" />
              <el-table-column prop="roomNo" label="房号" width="100" />
              <el-table-column label="身份" width="80">
                <template #default="{ row }">{{ residentLabels[row.residentType] ?? row.residentType }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90">
                <template #default="{ row }">
                  <el-button link type="primary" @click="$router.push(`/customers/${row.id}`)">查看</el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <el-divider>车牌登记</el-divider>
          <el-tag v-for="p in detail.plates" :key="p" style="margin-right: 8px">{{ p }}</el-tag>
          <el-input v-model="newPlate" placeholder="新车牌号（国内车牌格式）" style="width: 160px; margin-right: 8px" />
          <el-button type="primary" size="small" @click="addPlate">登记车牌</el-button>
          <el-divider>房屋状态流转（受状态机约束）</el-divider>
          <el-select v-model="targetStatus" placeholder="目标状态" style="width: 140px; margin-right: 8px">
            <el-option v-for="(label, v) in statusLabels" :key="v" :label="label" :value="v" />
          </el-select>
          <el-button type="primary" size="small" @click="transitionStatus">变更状态</el-button>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>欠费状态</template>
          <el-descriptions :column="2" border v-if="feeStatus">
            <el-descriptions-item label="物业费起始月">{{ feeStatus.feeStartMonth }}</el-descriptions-item>
            <el-descriptions-item label="累计计费月数">{{ feeStatus.totalBillableMonths }}</el-descriptions-item>
            <el-descriptions-item label="已缴费月数">{{ feeStatus.paidMonths }}</el-descriptions-item>
            <el-descriptions-item label="剩余应交费月份">
              <el-tag :type="feeStatus.remainingMonths > 0 ? 'danger' : 'success'">{{ feeStatus.remainingMonths }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="累计欠费月份">{{ feeStatus.arrearsMonths }}</el-descriptions-item>
            <el-descriptions-item label="欠费金额">
              <span class="amount">{{ (feeStatus.arrearsAmount / 100).toFixed(2) }} 元</span>
            </el-descriptions-item>
          </el-descriptions>
          <el-divider>已缴月段</el-divider>
          <el-tag v-for="(l, i) in feeStatus?.paidLedgers ?? []" :key="i" type="info" style="margin: 0 8px 8px 0">
            {{ l.startMonth }} ~ {{ l.endMonth }}（{{ l.months }}个月）
          </el-tag>
        </el-card>
        <el-card style="margin-top: 16px">
          <template #header>变更历史（脱敏留痕）</template>
          <el-timeline>
            <el-timeline-item v-for="log in changeLogs" :key="log.id" :timestamp="log.changedAt?.slice(0, 19).replace('T', ' ')">
              {{ log.fieldName }}：{{ log.oldValue }} → {{ log.newValue }}
            </el-timeline-item>
          </el-timeline>
          <el-empty v-if="changeLogs.length === 0" description="暂无变更记录" :image-size="60" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { HOUSE_STATUS_LABELS, RESIDENT_TYPE_LABELS } from '@pms/shared';
import { http } from '@/api/request';

const route = useRoute();
const customerId = computed(() => Number(route.params.id));
const detail = ref<Record<string, any> | null>(null);
const feeStatus = ref<Record<string, any> | null>(null);
const changeLogs = ref<Record<string, any>[]>([]);
const newPlate = ref('');
const targetStatus = ref('');
const statusLabels = HOUSE_STATUS_LABELS;
const residentLabels = RESIDENT_TYPE_LABELS;

async function load() {
  if (!Number.isFinite(customerId.value) || customerId.value <= 0) {
    ElMessage.error('客户编号无效，请从客户列表进入详情');
    return;
  }
  detail.value = await http.get<never, Record<string, any>>(`/customers/${customerId.value}`);
  feeStatus.value = await http.get<never, Record<string, any>>('/fees/fee-status', { params: { customerId: customerId.value } });
  const logs = await http.get<never, { list: Record<string, any>[] }>(`/customers/${customerId.value}/change-logs`);
  changeLogs.value = logs.list;
}

async function addPlate() {
  if (!newPlate.value) return;
  try {
    await http.post(`/customers/${customerId.value}/plates`, { plateNo: newPlate.value });
    ElMessage.success('车牌登记成功');
    newPlate.value = '';
    await load();
  } catch {
    // 拦截器提示
  }
}

async function transitionStatus() {
  if (!targetStatus.value) return;
  try {
    await http.post(`/customers/${customerId.value}/house-status`, { target: targetStatus.value });
    ElMessage.success('房屋状态已变更');
    await load();
  } catch {
    // PMS-3005 非法流转由拦截器提示
  }
}

onMounted(load);
</script>

<style scoped>
.amount { color: #f56c6c; font-weight: bold; }
</style>