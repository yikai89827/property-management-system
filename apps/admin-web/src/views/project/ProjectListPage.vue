<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>项目管理（多小区并行）</span>
        <el-button v-if="auth.hasPermission('project:create')" type="primary" @click="openCreate">新建项目</el-button>
      </div>
    </template>
    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="id" label="项目编号" width="90" />
      <el-table-column prop="name" label="项目名称" min-width="120" />
      <el-table-column prop="address" label="小区地址" min-width="160" show-overflow-tooltip />
      <el-table-column label="占地面积（㎡）" width="120">
        <template #default="{ row }">{{ Number(row.landArea).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="住房单价" width="150">
        <template #default="{ row }">
          <div class="fee-cell">
            <span>{{ formatYuanPerSqm(row.propertyFeeUnitPrice) }}</span>
            <el-tag size="small" :type="row.propertyFeeSource === 'project' ? 'success' : 'info'" effect="plain">
              {{ row.propertyFeeSource === 'project' ? '项目自设' : '公司默认' }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="门面一楼" width="140">
        <template #default="{ row }">
          <div class="fee-cell">
            <span>{{ formatYuanPerSqm(row.propertyFeeUnitPriceCommercial) }}</span>
            <el-tag
              size="small"
              :type="row.propertyFeeCommercialSource === 'project' ? 'success' : 'info'"
              effect="plain"
            >
              {{ row.propertyFeeCommercialSource === 'project' ? '项目自设' : '公司默认' }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="门面二楼" width="140">
        <template #default="{ row }">
          <div class="fee-cell">
            <span>{{ formatYuanPerSqm(row.propertyFeeUnitPriceCommercialL2) }}</span>
            <el-tag
              size="small"
              :type="row.propertyFeeCommercialL2Source === 'project' ? 'success' : 'info'"
              effect="plain"
            >
              {{ row.propertyFeeCommercialL2Source === 'project' ? '项目自设' : '公司默认' }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="customerCount" label="客户数" width="80" />
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ statusLabels[row.status] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="320">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="openFeeSettings(row)">费用设定</el-button>
          <el-button link type="primary" @click="useAsCurrent(row)">设为当前</el-button>
          <el-button link type="primary" @click="genQr(row)">缴费二维码</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="load"
      style="margin-top: 12px"
    />

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑项目' : '新建项目'" width="520">
      <el-form :model="form" label-width="90px">
        <el-form-item label="项目名称" required>
          <el-input v-model="form.name" maxlength="50" show-word-limit placeholder="如：桌信花园" />
        </el-form-item>
        <el-form-item label="小区地址">
          <el-input v-model="form.address" maxlength="200" placeholder="便于多项目区分" />
        </el-form-item>
        <el-form-item label="占地面积" required>
          <el-input-number v-model="form.landArea" :min="0.01" :precision="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="feeVisible"
      :title="`费用设定 — ${feeProject?.name ?? ''}`"
      width="720"
      destroy-on-close
    >
      <p class="fee-tip">
        按本项目单独设定；未单独设定的项沿用公司默认。门面一楼面积×2、二楼×0.7；住房装修面积×90×0.02、门面装修面积×0.01×90；垃圾清运面积×2.5。调整仅对新生成缴费单生效。
      </p>
      <el-table :data="feeRows" v-loading="feeLoading" border size="small">
        <el-table-column prop="label" label="参数项" min-width="160" />
        <el-table-column label="当前生效" width="130">
          <template #default="{ row }">{{ row.display }}</template>
        </el-table-column>
        <el-table-column label="来源" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.source === 'project' ? 'success' : 'info'" effect="plain">
              {{ row.source === 'project' ? '项目自设' : '公司默认' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="项目新值" width="160">
          <template #default="{ row }">
            <el-input-number
              v-model="row.newValue"
              :min="0.01"
              :precision="2"
              size="small"
              :disabled="!canEditFee"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button
              v-if="canEditFee"
              link
              type="primary"
              :loading="row.saving"
              @click="saveFeeRow(row)"
            >
              保存
            </el-button>
            <span v-else class="muted">仅查看</span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="qrVisible" title="项目缴费二维码（业主扫码进入身份验证）" width="420">
      <div class="qr-wrap" v-loading="qrLoading">
        <canvas ref="qrCanvas" width="260" height="260" />
        <p class="qr-label">{{ qrLabel }}</p>
        <p class="qr-url">{{ qrUrl }}</p>
        <el-button type="primary" :disabled="!qrReady" @click="downloadQr">下载二维码物料</el-button>
      </div>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import QRCode from 'qrcode';
import { COMMON_STATUS_LABELS, FEE_PARAMETER_LABELS, FeeParameterCode } from '@pms/shared';
import { http } from '@/api/request';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';

const auth = useAuthStore();
const projectStore = useProjectStore();
const statusLabels = COMMON_STATUS_LABELS as Record<string, string>;
const list = ref<Record<string, any>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const dialogVisible = ref(false);
const editing = ref<number | null>(null);
const form = reactive({ name: '', landArea: 100, address: '' });
const qrVisible = ref(false);
const qrCanvas = ref<HTMLCanvasElement>();
const qrUrl = ref('');
const qrLabel = ref('');
const qrLoading = ref(false);
const qrReady = ref(false);

const feeVisible = ref(false);
const feeLoading = ref(false);
const feeProject = ref<Record<string, any> | null>(null);
const feeRows = ref<
  {
    code: string;
    label: string;
    value: number;
    display: string;
    source: 'project' | 'company';
    newValue: number;
    saving?: boolean;
  }[]
>([]);

const canEditFee = computed(
  () => auth.hasPermission('project:update') || auth.hasPermission('fee-parameter:manage'),
);

const displayDiv: Record<string, number> = {
  [FeeParameterCode.DEPOSIT_DECORATION_AMOUNT]: 100,
  [FeeParameterCode.DECORATION_MGMT_RATE]: 100,
  [FeeParameterCode.DECORATION_MGMT_RATE_COMMERCIAL]: 100,
  [FeeParameterCode.GARBAGE_TRANSPORT_RATE]: 100,
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE]: 100,
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL]: 100,
  [FeeParameterCode.PROPERTY_FEE_UNIT_PRICE_COMMERCIAL_L2]: 100,
};

function formatParam(code: string, value: number) {
  const div = displayDiv[code] ?? 1;
  const unit = code === FeeParameterCode.DEPOSIT_DECORATION_AMOUNT ? ' 元' : ' 元/㎡';
  return `${(value / div).toFixed(2)}${unit}`;
}

function formatYuanPerSqm(cents: number | undefined) {
  return `${((Number(cents) || 0) / 100).toFixed(2)} 元/㎡`;
}

async function load() {
  loading.value = true;
  try {
    const data = await http.get<never, { list: Record<string, any>[]; total: number }>('/projects', {
      params: { page: page.value, pageSize },
    });
    list.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.name = '';
  form.landArea = 100;
  form.address = '';
  dialogVisible.value = true;
}

function openEdit(row: Record<string, any>) {
  editing.value = row.id as number;
  form.name = row.name as string;
  form.landArea = Number(row.landArea);
  form.address = (row.address as string) || '';
  dialogVisible.value = true;
}

function useAsCurrent(row: Record<string, any>) {
  projectStore.setCurrent(row.id as number);
  ElMessage.success(`已切换当前项目为「${row.name}」`);
}

async function submit() {
  if (!form.name || form.name.length > 50) {
    ElMessage.warning('项目名称必填且不超过 50 字符');
    return;
  }
  if (form.landArea <= 0) {
    ElMessage.warning('占地面积必须大于 0');
    return;
  }
  try {
    if (editing.value) {
      await http.patch(`/projects/${editing.value}`, form);
      ElMessage.success('项目已更新（历史收款单快照保持开单时刻名称）');
    } else {
      await http.post('/projects', form);
      ElMessage.success('项目创建成功');
    }
    dialogVisible.value = false;
    await load();
    await projectStore.loadOptions();
  } catch {
    // PMS-2001 重名等错误由拦截器提示
  }
}

async function openFeeSettings(row: Record<string, any>) {
  feeProject.value = row;
  feeVisible.value = true;
  feeLoading.value = true;
  try {
    const items = await http.get<never, { itemCode: string; value: number; source: 'project' | 'company' }[]>(
      `/projects/${row.id}/fee-parameters`,
    );
    feeRows.value = (items ?? []).map((i) => ({
      code: i.itemCode,
      label: FEE_PARAMETER_LABELS[i.itemCode as FeeParameterCode] ?? i.itemCode,
      value: i.value,
      display: formatParam(i.itemCode, i.value),
      source: i.source,
      newValue: i.value / (displayDiv[i.itemCode] ?? 1),
    }));
  } finally {
    feeLoading.value = false;
  }
}

async function saveFeeRow(row: (typeof feeRows.value)[0]) {
  if (!feeProject.value) return;
  if (!row.newValue || row.newValue <= 0) {
    ElMessage.warning('参数值必须大于 0');
    return;
  }
  row.saving = true;
  try {
    const value = Math.round(row.newValue * (displayDiv[row.code] ?? 1));
    if (auth.hasPermission('project:update')) {
      await http.put(`/projects/${feeProject.value.id}/fee-parameters`, {
        itemCode: row.code,
        value,
      });
    } else {
      await http.put('/fee-parameters', {
        itemCode: row.code,
        projectId: feeProject.value.id,
        value,
      });
    }
    ElMessage.success('已按本项目生效新版本（仅影响新缴费单）');
    await openFeeSettings(feeProject.value);
    await load();
  } finally {
    row.saving = false;
  }
}

async function genQr(row: Record<string, unknown>) {
  const { protocol, hostname, port } = window.location;
  const projectId = Number(row.id);
  const ownerBase =
    port === '5170' || hostname === 'localhost' || hostname === '127.0.0.1'
      ? `${protocol}//${hostname}:5171`
      : `${protocol}//${hostname}/h5`;
  qrUrl.value = `${ownerBase}/?project=${projectId}#/verify?project=${projectId}`;
  qrLabel.value = `${row.name ?? `项目 ${projectId}`} 缴费入口（项目 ID：${projectId}）`;
  qrReady.value = false;
  qrVisible.value = true;
  await nextTick();
  await drawQr(qrUrl.value);
}

function downloadQr() {
  const canvas = qrCanvas.value;
  if (!canvas || !qrReady.value) return;
  const link = document.createElement('a');
  const pid = qrUrl.value.match(/[?&]project=(\d+)/)?.[1] ?? 'project';
  link.download = `缴费二维码-项目${pid}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function drawQr(text: string) {
  const canvas = qrCanvas.value;
  if (!canvas) return;
  qrLoading.value = true;
  try {
    await QRCode.toCanvas(canvas, text, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
    qrReady.value = true;
  } catch {
    qrReady.value = false;
    ElMessage.error('二维码生成失败，请重试');
  } finally {
    qrLoading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
.fee-cell { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.fee-tip { margin: 0 0 12px; font-size: 13px; color: var(--el-text-color-secondary); }
.muted { font-size: 12px; color: var(--el-text-color-secondary); }
.qr-wrap { text-align: center; min-height: 320px; }
.qr-label { margin: 8px 0 4px; font-size: 13px; color: var(--el-text-color-regular); }
.qr-url { font-size: 12px; color: #909399; word-break: break-all; }
</style>
