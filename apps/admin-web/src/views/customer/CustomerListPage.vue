<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>客户档案（手机号主识别 · 支持跨项目多房）</span>
        <div class="header-actions">
          <el-button v-if="auth.hasPermission('customer:create')" @click="downloadTemplate">下载导入模板</el-button>
          <el-button v-if="auth.hasPermission('customer:create')" @click="openImport">Excel 一键导入</el-button>
          <el-button v-if="auth.hasPermission('customer:create')" type="primary" @click="openCreate">新建客户</el-button>
        </div>
      </div>
    </template>
    <el-form inline>
      <el-form-item label="当前项目">
        <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
      </el-form-item>
      <el-form-item label="手机号">
        <el-input v-model="query.phone" placeholder="主识别检索" style="width: 140px" maxlength="11" />
      </el-form-item>
      <el-form-item label="身份证号">
        <el-input v-model="query.idCard" placeholder="可选" style="width: 160px" maxlength="18" />
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
      <el-form-item label="房屋性质">
        <el-select v-model="query.propertyType" placeholder="全部" clearable style="width: 120px">
          <el-option v-for="o in propertyOptions" :key="o.value" :label="o.label" :value="o.value" />
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
      <el-table-column label="房屋性质" width="80">
        <template #default="{ row }">{{ propertyLabels[row.propertyType] ?? '住房' }}</template>
      </el-table-column>
      <el-table-column prop="roomNo" label="房号" width="100" />
      <el-table-column prop="idCardMasked" label="身份证号" min-width="140">
        <template #default="{ row }">{{ row.idCardMasked || '—' }}</template>
      </el-table-column>
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

    <el-dialog v-model="importVisible" title="Excel 一键导入客户（期初数据）" width="640">
      <p class="import-tip">
        请先下载模板，按列填写后上传。支持导入物业费起始日期与「已缴月数」作为期初台账（例如系统 2017-01 启用，可填起始日与已缴月数）。
        未填项目编号时，使用下方默认项目。
      </p>
      <el-form label-width="120px">
        <el-form-item label="默认项目">
          <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
          <span class="import-project-hint">（随顶部当前项目）</span>
        </el-form-item>
        <el-form-item label="导入后确认">
          <el-checkbox v-model="importConfirmProfile">导入成功后自动确认档案</el-checkbox>
        </el-form-item>
        <el-form-item label="选择文件">
          <input ref="fileInput" type="file" accept=".xlsx,.xls" @change="onImportFile" />
        </el-form-item>
      </el-form>
      <div v-if="importResult" class="import-result">
        <p>
          成功 <b>{{ importResult.successCount }}</b> 户，失败
          <b>{{ importResult.failedCount }}</b> 户（共 {{ importResult.total }} 行）
        </p>
        <el-table v-if="importResult.failed?.length" :data="importResult.failed" size="small" border max-height="240">
          <el-table-column prop="row" label="行号" width="70" />
          <el-table-column prop="roomNo" label="房号" width="100" />
          <el-table-column prop="reason" label="失败原因" min-width="200" show-overflow-tooltip />
        </el-table>
      </div>
      <template #footer>
        <el-button @click="importVisible = false">关闭</el-button>
        <el-button type="primary" :loading="importing" :disabled="!importRows.length" @click="submitImport">
          开始导入（{{ importRows.length }} 行）
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogVisible" title="新建客户档案" width="640">
      <el-form :model="form" label-width="140px">
        <el-form-item label="所属项目">
          <el-tag type="primary" effect="plain">{{ projectName }}</el-tag>
        </el-form-item>
        <el-form-item label="住户类型" required>
          <el-radio-group v-model="form.residentType">
            <el-radio v-for="(label, v) in residentLabels" :key="v" :value="v">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="房屋性质" required>
          <el-radio-group v-model="form.propertyType">
            <el-radio v-for="o in propertyOptions" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input v-model="form.phone" placeholder="主识别标识（国内手机号）" maxlength="11" />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="房号" required>
          <el-input v-model="form.roomNo" placeholder="同项目唯一；同一手机号可跨项目多房" />
        </el-form-item>
        <el-form-item label="身份证号">
          <el-input v-model="form.idCard" maxlength="18" placeholder="可选；有则填写" @blur="checkIdCard" />
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
            <!-- 未交房→未装修须走交房缴费；此处可选三态便于存量导入 -->
            <el-option
              v-for="(label, v) in createStatusOptions"
              :key="v"
              :label="label"
              :value="v"
            />
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
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import * as XLSX from 'xlsx';
import {
  HOUSE_STATUS_LABELS,
  HouseStatus,
  PROPERTY_TYPE_LABELS,
  PropertyType,
  RESIDENT_TYPE_LABELS,
  ResidentType,
} from '@pms/shared';
import { http } from '@/api/request';
import { useAuthStore } from '@/stores/auth';
import { useCurrentProject } from '@/composables/useCurrentProject';

const auth = useAuthStore();
const { projectStore, currentProjectId, projectName, requireProjectId } = useCurrentProject({
  onChange: () => {
    page.value = 1;
    void load();
  },
});
const statusLabels: Record<string, string> = {
  [HouseStatus.UNDELIVERED]: HOUSE_STATUS_LABELS[HouseStatus.UNDELIVERED],
  [HouseStatus.UNDECORATED]: HOUSE_STATUS_LABELS[HouseStatus.UNDECORATED],
  [HouseStatus.DECORATED]: HOUSE_STATUS_LABELS[HouseStatus.DECORATED],
};
/** 新建档案可选：未交房 / 未装修 / 已装修；「未交房→未装修」仍须走交房缴费 */
const createStatusOptions = {
  [HouseStatus.UNDELIVERED]: HOUSE_STATUS_LABELS[HouseStatus.UNDELIVERED],
  [HouseStatus.UNDECORATED]: HOUSE_STATUS_LABELS[HouseStatus.UNDECORATED],
  [HouseStatus.DECORATED]: HOUSE_STATUS_LABELS[HouseStatus.DECORATED],
};
const residentLabels = RESIDENT_TYPE_LABELS;
const propertyLabels = PROPERTY_TYPE_LABELS;
/** 建档/筛选可选：住房、门面一楼、门面二楼（不含旧 COMMERCIAL 别名） */
const propertyOptions = [
  { value: PropertyType.RESIDENTIAL, label: PROPERTY_TYPE_LABELS[PropertyType.RESIDENTIAL] },
  { value: PropertyType.COMMERCIAL_L1, label: PROPERTY_TYPE_LABELS[PropertyType.COMMERCIAL_L1] },
  { value: PropertyType.COMMERCIAL_L2, label: PROPERTY_TYPE_LABELS[PropertyType.COMMERCIAL_L2] },
];
const list = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const query = reactive({
  roomNo: '',
  name: '',
  phone: '',
  idCard: '',
  residentType: undefined as string | undefined,
  propertyType: undefined as string | undefined,
});
const dialogVisible = ref(false);
const importVisible = ref(false);
const importConfirmProfile = ref(true);
const importRows = ref<Record<string, unknown>[]>([]);
const importing = ref(false);
const importResult = ref<{
  total: number;
  successCount: number;
  failedCount: number;
  failed: { row: number; roomNo?: string; reason: string }[];
} | null>(null);
const fileInput = ref<HTMLInputElement>();

const TEMPLATE_HEADERS = [
  '项目编号',
  '项目名称',
  '房号',
  '姓名',
  '手机号',
  '身份证号',
  '房屋性质',
  '房屋面积',
  '物业费起始日期',
  '已缴月数',
  '房屋状态',
  '住户类型',
  '合同日期',
  '装修日期',
];
const form = reactive({
  residentType: ResidentType.OWNER as string,
  propertyType: PropertyType.RESIDENTIAL as string,
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
      params: {
        ...query,
        projectId: currentProjectId.value ?? undefined,
        page: page.value,
        pageSize,
      },
    });
    list.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  if (!requireProjectId()) return;
  Object.assign(form, {
    residentType: ResidentType.OWNER,
    propertyType: PropertyType.RESIDENTIAL,
    name: '', phone: '', roomNo: '', idCard: '',
    houseArea: 100, feeStartDate: '', decorateDate: '', contractDate: '',
    houseStatus: HouseStatus.UNDELIVERED,
    confirmAfterCreate: true,
  });
  dialogVisible.value = true;
}

function downloadTemplate() {
  const sample = [
    TEMPLATE_HEADERS,
    [
      currentProjectId.value ?? 1,
      projectName.value !== '未选择项目' ? projectName.value : '示例花园',
      '1-101',
      '张三',
      '13800138000',
      '',
      '住房',
      98.5,
      '2017-01-01',
      96,
      '入住',
      '业主',
      '2016-12-15',
      '',
    ],
    [
      '',
      '',
      '临街-01',
      '王五',
      '13900139000',
      '',
      '门面一楼',
      60,
      '2018-06-01',
      24,
      '入住',
      '业主',
      '',
      '',
    ],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sample);
  sheet['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['填写说明'],
    ['1. 必填：房号、姓名、手机号、房屋面积、物业费起始日期（身份证号可选）'],
    ['2. 项目：可填「项目编号」或「项目名称」；都空则使用导入弹窗中的默认项目'],
    ['3. 房屋性质：住房 / 门面一楼（面积×2）/ 门面二楼（面积×0.7）；也可填「一楼」「二楼」'],
    ['4. 物业费起始日期：建议 YYYY-MM-DD；也可填 YYYY-MM'],
    ['5. 已缴月数：期初已缴清的月份数（从起始月起连续已缴），用于系统启用前的历史缴费'],
    ['6. 房屋状态：未交房 / 未装修 / 已装修'],
    ['7. 住户类型：业主 / 租户'],
    ['8. 请删除示例行后再导入正式数据；单次建议不超过 2000 行'],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '客户导入');
  XLSX.utils.book_append_sheet(book, guide, '填写说明');
  XLSX.writeFile(book, '客户档案导入模板.xlsx');
  ElMessage.success('模板已下载');
}

function openImport() {
  if (!requireProjectId()) return;
  importRows.value = [];
  importResult.value = null;
  importVisible.value = true;
  if (fileInput.value) fileInput.value.value = '';
}

function onImportFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      importRows.value = rows.filter((r) =>
        Object.values(r).some((v) => String(v ?? '').trim() !== ''),
      );
      importResult.value = null;
      ElMessage.success(`已读取 ${importRows.value.length} 行，请点击开始导入`);
    } catch {
      ElMessage.error('无法解析 Excel，请使用下载的模板');
      importRows.value = [];
    }
  };
  reader.readAsArrayBuffer(file);
}

async function submitImport() {
  const pid = requireProjectId();
  if (!pid) return;
  if (!importRows.value.length) {
    ElMessage.warning('请先选择 Excel 文件');
    return;
  }
  importing.value = true;
  try {
    importResult.value = await http.post<
      never,
      {
        total: number;
        successCount: number;
        failedCount: number;
        failed: { row: number; roomNo?: string; reason: string }[];
      }
    >('/customers/import', {
      defaultProjectId: pid,
      confirmProfile: importConfirmProfile.value,
      rows: importRows.value,
    });
    ElMessage.success(`导入完成：成功 ${importResult.value.successCount}，失败 ${importResult.value.failedCount}`);
    await load();
  } finally {
    importing.value = false;
  }
}

function checkIdCard() {
  const id = form.idCard.trim();
  if (!id) return;
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
  const pid = requireProjectId();
  if (!pid) return;
  if (!form.name || !form.phone || !form.roomNo || !form.houseArea || !form.feeStartDate) {
    ElMessage.warning('请填写全部必填项（手机号为主识别标识）');
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(form.phone)) {
    ElMessage.warning('手机号格式不正确');
    return;
  }
  try {
    const created = await http.post<never, { id: number }>('/customers', {
      ...form,
      projectId: pid,
      idCard: form.idCard.trim() || undefined,
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

onMounted(async () => {
  if (!projectStore.loaded) await projectStore.loadOptions();
  await load();
});
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.header-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.import-tip { margin: 0 0 12px; font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.5; }
.import-result { margin-top: 12px; font-size: 13px; }
.import-project-hint { margin-left: 8px; font-size: 12px; color: var(--el-text-color-secondary); }
</style>
