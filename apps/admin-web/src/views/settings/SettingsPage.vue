<template>
  <el-card>
    <template #header>系统配置（费用参数 / 字典）</template>
    <h4>公司默认费用参数</h4>
    <p class="hint">
      此处为全公司默认值；各小区可在「项目管理 → 费用设定」单独覆盖。调整仅对新生成缴费单生效，历史收款单不变。
      住房：物业费按住房单价；装修管理费面积×90×0.02。门面一楼物业费面积×2、二楼×0.7；门面装修管理费面积×0.01×90；垃圾清运面积×2.5（共用）。
    </p>
    <el-table :data="paramRows" border>
      <el-table-column prop="label" label="参数项" />
      <el-table-column label="当前值" width="160">
        <template #default="{ row }">{{ row.display }}</template>
      </el-table-column>
      <el-table-column label="新值" width="200">
        <template #default="{ row }">
          <el-input-number v-model="row.newValue" :min="0.01" :precision="2" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button link type="primary" @click="updateParam(row)">调整</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-collapse style="margin-top: 12px">
      <el-collapse-item title="参数变更历史（版本化保留）">
        <el-timeline>
          <el-timeline-item v-for="h in paramHistory" :key="h.id" :timestamp="formatDateTime(h.effectiveAt)">
            {{ paramLabels[h.itemCode] ?? h.itemCode }} → {{ formatParam(h.itemCode, h.value) }}（操作人 {{ h.operatorId ?? '系统' }}）
          </el-timeline-item>
        </el-timeline>
      </el-collapse-item>
    </el-collapse>

    <el-divider>字典管理</el-divider>
    <el-row :gutter="24">
      <el-col :span="12">
        <h4>费用类别（其他缴费筛选项）</h4>
        <el-table :data="categories" border size="small">
          <el-table-column prop="code" label="编码" width="150" />
          <el-table-column prop="name" label="名称" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link :type="row.enabled ? 'warning' : 'success'" @click="toggleCategory(row)">
                {{ row.enabled ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-form inline style="margin-top: 8px">
          <el-form-item>
            <el-input v-model="newCategory.code" placeholder="编码（如 PARKING）" style="width: 140px" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="newCategory.name" placeholder="名称（如 车位清洁费）" style="width: 140px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="small" @click="addCategory">新增类别</el-button>
          </el-form-item>
        </el-form>
      </el-col>
      <el-col :span="12">
        <h4>收款方式</h4>
        <el-table :data="methods" border size="small">
          <el-table-column prop="code" label="编码" width="150" />
          <el-table-column prop="name" label="名称" />
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link :type="row.enabled ? 'warning' : 'success'" @click="toggleMethod(row)">
                {{ row.enabled ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-form inline style="margin-top: 8px">
          <el-form-item>
            <el-input v-model="newMethod.code" placeholder="编码（如 QR_PAY）" style="width: 140px" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="newMethod.name" placeholder="名称（如 扫码支付）" style="width: 140px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="small" @click="addMethod">新增方式</el-button>
          </el-form-item>
        </el-form>
      </el-col>
    </el-row>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { FEE_PARAMETER_LABELS, FeeParameterCode } from '@pms/shared';
import { http } from '@/api/request';
import { formatDateTime } from '@/utils/format';

const paramLabels = FEE_PARAMETER_LABELS;
/** 显示换算：金额/平方米类参数以元展示 */
const displayRules: Record<string, number> = {
  [FeeParameterCode.DEPOSIT_DECORATION_AMOUNT]: 100,
  [FeeParameterCode.DECORATION_MGMT_RATE]: 100,
  [FeeParameterCode.DECORATION_MGMT_RATE_COMMERCIAL]: 100,
  [FeeParameterCode.GARBAGE_TRANSPORT_RATE]: 100,
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE]: 100,
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL]: 100,
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2]: 100,
};

const paramRows = ref<Record<string, any>[]>([]);
const paramHistory = ref<Record<string, any>[]>([]);
const categories = ref<Record<string, any>[]>([]);
const methods = ref<Record<string, any>[]>([]);
const newCategory = reactive({ code: '', name: '' });
const newMethod = reactive({ code: '', name: '' });

function formatParam(code: string, value: number): string {
  const div = displayRules[code] ?? 1;
  return `${(value / div).toFixed(2)}${code === FeeParameterCode.DEPOSIT_DECORATION_AMOUNT ? ' 元' : ' 元/㎡'}`;
}

async function loadParams() {
  const current = await http.get<never, Record<string, number>>('/fee-parameters');
  paramRows.value = Object.entries(current).map(([code, value]) => ({
    code,
    label: paramLabels[code] ?? code,
    value,
    display: formatParam(code, value),
    newValue: value / (displayRules[code] ?? 1),
  }));
  paramHistory.value = await http.get<never, Record<string, any>[]>('/fee-parameters/history');
}

async function updateParam(row: Record<string, any>) {
  await http.put('/fee-parameters', {
    itemCode: row.code,
    value: Math.round(row.newValue * (displayRules[row.code] ?? 1)),
  });
  ElMessage.success('已生效新版本：仅对新生成缴费单生效，历史收款单保持原值');
  await loadParams();
}

async function loadDicts() {
  categories.value = await http.get<never, Record<string, any>[]>('/fee-categories');
  methods.value = await http.get<never, Record<string, any>[]>('/payment-methods');
}

async function addCategory() {
  if (!newCategory.code || !newCategory.name) {
    ElMessage.warning('请填写类别编码与名称');
    return;
  }
  await http.post('/fee-categories', newCategory);
  ElMessage.success('新增成功，其他缴费页立即可选（零代码变更）');
  newCategory.code = '';
  newCategory.name = '';
  await loadDicts();
}

async function addMethod() {
  if (!newMethod.code || !newMethod.name) {
    ElMessage.warning('请填写方式编码与名称');
    return;
  }
  await http.post('/payment-methods', newMethod);
  ElMessage.success('新增成功');
  newMethod.code = '';
  newMethod.name = '';
  await loadDicts();
}

async function toggleCategory(row: Record<string, any>) {
  await http.patch(`/fee-categories/${row.id}`, { enabled: !row.enabled });
  ElMessage.success(row.enabled ? '已停用（缴费页不再可选，历史单据不受影响）' : '已重新启用');
  await loadDicts();
}

async function toggleMethod(row: Record<string, any>) {
  await http.patch(`/payment-methods/${row.id}`, { enabled: !row.enabled });
  ElMessage.success(row.enabled ? '已停用（缴费页不再可选，历史单据不受影响）' : '已重新启用');
  await loadDicts();
}

onMounted(async () => {
  await loadParams();
  await loadDicts();
});
</script>

<style scoped>
.hint {
  margin: -4px 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>