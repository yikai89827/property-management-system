<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>项目管理（多小区并行）</span>
        <el-button v-if="auth.hasPermission('project:create')" type="primary" @click="openCreate">新建项目</el-button>
      </div>
    </template>
    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="id" label="项目编号" width="100" />
      <el-table-column prop="name" label="项目名称" min-width="140" />
      <el-table-column prop="address" label="小区地址" min-width="200" show-overflow-tooltip />
      <el-table-column label="占地面积（㎡）" width="140">
        <template #default="{ row }">{{ Number(row.landArea).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="customerCount" label="客户数" width="90" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ statusLabels[row.status] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ row.createdAt?.slice(0, 19).replace('T', ' ') }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="useAsCurrent(row)">设为当前</el-button>
          <el-button link type="primary" @click="genQr(row)">生成缴费二维码</el-button>
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
import { nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import QRCode from 'qrcode';
import { COMMON_STATUS_LABELS } from '@pms/shared';
import { http } from '@/api/request';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';

const auth = useAuthStore();
const projectStore = useProjectStore();
const statusLabels = COMMON_STATUS_LABELS as Record<string, string>;
const list = ref<Record<string, unknown>[]>([]);
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

async function load() {
  loading.value = true;
  try {
    const data = await http.get<never, { list: Record<string, unknown>[]; total: number }>('/projects', {
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

function openEdit(row: Record<string, unknown>) {
  editing.value = row.id as number;
  form.name = row.name as string;
  form.landArea = Number(row.landArea);
  form.address = (row.address as string) || '';
  dialogVisible.value = true;
}

function useAsCurrent(row: Record<string, unknown>) {
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

async function genQr(row: Record<string, unknown>) {
  const { protocol, hostname, port } = window.location;
  // 开发：独立 5171；生产 Nginx：/h5/
  const ownerBase =
    port === '5170' || hostname === 'localhost' || hostname === '127.0.0.1'
      ? `${protocol}//${hostname}:5171`
      : `${protocol}//${hostname}/h5`;
  qrUrl.value = `${ownerBase}/#/verify?project=${row.id}`;
  qrLabel.value = `项目 ${row.name ?? row.id} 缴费入口`;
  qrReady.value = false;
  qrVisible.value = true;
  await nextTick();
  await drawQr(qrUrl.value);
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

function downloadQr() {
  const canvas = qrCanvas.value;
  if (!canvas || !qrReady.value) return;
  const link = document.createElement('a');
  link.download = 'project-payment-qr.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

onMounted(load);
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
.qr-wrap { text-align: center; min-height: 320px; }
.qr-label { margin: 8px 0 4px; font-size: 13px; color: var(--el-text-color-regular); }
.qr-url { font-size: 12px; color: #909399; word-break: break-all; }
</style>
