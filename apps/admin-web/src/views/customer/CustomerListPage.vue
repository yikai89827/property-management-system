<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>客户档案（身份证唯一身份 · 支持跨项目多房）</span>
        <el-button v-if="auth.hasPermission('customer:create')" type="primary" @click="openCreate">新建客户</el-button>
      </div>
    </template>
    <el-form inline>
      <el-form-item label="项目">
        <el-select v-model="query.projectId" placeholder="全部项目" clearable style="width: 180px">
          <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="身份证号">
        <el-input v-model="query.idCard" placeholder="唯一身份检索" style="width: 180px" maxlength="18" />
      </el-form-item>
      <el-form-item label="房号">
        <el-input v-model="query.roomNo" placeholder="如 1-101" style="width: 120px" />
      </el-form-item>
      <el-form-item label="姓名">
        <el-input v-model="query.name" style="width: 100px" />
      </el-form-item>
      <el-form-item label="身份">
        <el-select v-model="query.residentType" placeholder="全部" clearable style="width: 110px">
          <el-option v-for="(label, v) in residentLabels" :key="v" :label="label" :value="v" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="load">查询</el-button>
      </el-form-item>
    </el-form>
    <el-table :data="list" v-loading="loading" border>
      <el-table-column prop="id" label="编号" width="70" />
      <el-table-column prop="projectName" label="所属项目" min-width="120" />
      <el-table-column prop="name" label="姓名" width="100" />
      <el-table-column label="身份" width="80">
        <template #default="{ row }">{{ residentLabels[row.residentType] ?? row.residentType }}</template>
      </el-table-column>
      <el-table-column prop="roomNo" label="房号" width="100" />
      <el-table-column prop="idCardMasked" label="身份证号" min-width="160" />
      <el-table-column label="面积（㎡）" width="100">
        <template #default="{ row }">{{ (row.houseAreaFen / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column label="房屋状态" width="100">
        <template #default="{ row }">{{ statusLabels[row.houseStatus] ?? row.houseStatus }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button link type="primary" @click="$router.push(`/customers/${row.id}`)">详情</el-button>
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

    <el-dialog v-model="dialogVisible" title="新建客户档案" width="640">
      <el-form :model="form" label-width="140px">
        <el-form-item label="所属项目" required>
          <el-select v-model="form.projectId" style="width: 100%">
            <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="住户类型" required>
          <el-radio-group v-model="form.residentType">
            <el-radio v-for="(label, v) in residentLabels" :key="v" :value="v">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="身份证号" required>
          <el-input v-model="form.idCard" maxlength="18" placeholder="公司内唯一身份标识" @blur="checkIdCard" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="电话" required>
          <el-input v-model="form.phone" placeholder="国内手机号" />
        </el-form-item>
        <el-form-item label="房号" required>
          <el-input v-model="form.roomNo" placeholder="同项目唯一；同一身份证可跨项目多房" />
        </el-form-item>
        <el-form-item label="房屋面积（㎡）" required>
          <el-input-number v-model="form.houseArea" :min="0.01" :precision="2" />
        </el-form-item>
        <el-form-item label="物业费起始时间" required>
          <el-date-picker v-model="form.feeStartDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="装修时间">
          <el-date-picker v-model="form.decorateDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="合同签约时间">
          <el-date-picker v-model="form.contractDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="房屋状态" required>
          <el-select v-model="form.houseStatus" style="width: 200px">
            <el-option v-for="(label, v) in statusLabels" :key="v" :label="label" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="建档后">
          <el-checkbox v-model="form.confirmAfterCreate">立即确认档案（确认后核心字段锁定）</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { HOUSE_STATUS_LABELS, HouseStatus, RESIDENT_TYPE_LABELS, ResidentType } from '@pms/shared';
import { http } from '@/api/request';
import { useAuthStore } from '@/stores/auth';
import { useProjectStore } from '@/stores/project';

const auth = useAuthStore();
const projectStore = useProjectStore();
const statusLabels = HOUSE_STATUS_LABELS;
const residentLabels = RESIDENT_TYPE_LABELS;
const list = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const projects = ref<{ id: number; name: string }[]>([]);
const query = reactive({
  projectId: undefined as number | undefined,
  roomNo: '',
  name: '',
  idCard: '',
  residentType: undefined as string | undefined,
});
const dialogVisible = ref(false);
const form = reactive({
  projectId: undefined as number | undefined,
  residentType: ResidentType.OWNER as string,
  name: '',
  phone: '',
  roomNo: '',
  idCard: '',
  houseArea: 100,
  feeStartDate: '',
  decorateDate: '',
  contractDate: '',
  houseStatus: HouseStatus.UNDELIVERED,
  confirmAfterCreate: true,
});

async function load() {
  loading.value = true;
  try {
    const data = await http.get<never, { list: Record<string, unknown>[]; total: number }>('/customers', {
      params: { ...query, page: page.value, pageSize },
    });
    list.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(form, {
    projectId: query.projectId ?? projectStore.currentProjectId ?? projects.value[0]?.id,
    residentType: ResidentType.OWNER,
    name: '', phone: '', roomNo: '', idCard: '',
    houseArea: 100, feeStartDate: '', decorateDate: '', contractDate: '',
    houseStatus: HouseStatus.UNDELIVERED,
    confirmAfterCreate: true,
  });
  dialogVisible.value = true;
}

function checkIdCard() {
  const id = form.idCard;
  if (!/^\d{17}[\dXx]$/.test(id)) {
    ElMessage.warning('身份证号格式不正确（须为 18 位）');
    return;
  }
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = w.reduce((acc, wi, i) => acc + Number(id[i]) * wi, 0);
  if (id[17].toUpperCase() !== codes[sum % 11]) {
    ElMessage.warning('身份证号校验位不正确');
  }
}

async function submit() {
  if (!form.projectId || !form.name || !form.phone || !form.roomNo || !form.idCard || !form.houseArea || !form.feeStartDate) {
    ElMessage.warning('请填写全部必填项（含身份证号作为唯一身份标识）');
    return;
  }
  try {
    const created = await http.post<never, { id: number }>('/customers', {
      ...form,
      contractDate: form.contractDate || undefined,
      decorateDate: form.decorateDate || undefined,
    });
    if (form.confirmAfterCreate && created?.id) {
      await http.post(`/customers/${created.id}/confirm-profile`);
      ElMessage.success('客户档案已创建并确认锁定');
    } else {
      ElMessage.success('客户档案创建成功（请在详情页确认后锁定）');
    }
    dialogVisible.value = false;
    await load();
  } catch {
    // PMS-3002 / PMS-3003 / PMS-3006 等由拦截器提示
  }
}

watch(
  () => projectStore.currentProjectId,
  (id) => {
    if (id && query.projectId == null) {
      query.projectId = id;
      void load();
    }
  },
);

onMounted(async () => {
  const data = await http.get<never, { list: { id: number; name: string }[] }>('/projects', { params: { pageSize: 100 } });
  projects.value = data.list;
  if (!projectStore.loaded) await projectStore.loadOptions();
  if (projectStore.currentProjectId) query.projectId = projectStore.currentProjectId;
  await load();
});
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
