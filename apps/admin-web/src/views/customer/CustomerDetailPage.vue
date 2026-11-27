<template>
  <div v-if="detail">
    <el-page-header title="返回客户列表" @back="$router.back()" :content="`房源档案：${detail.name}（${detail.roomNo}）`" />
    <div class="toolbar">
      <el-tag v-if="detail.profileLocked" type="warning">档案已锁定</el-tag>
      <el-tag v-else-if="detail.profileConfirmedAt" type="success">已确认（临时解锁中）</el-tag>
      <el-tag v-else type="info">未确认</el-tag>
      <el-button v-if="!detail.profileConfirmedAt" type="primary" size="small" @click="confirmProfile">确认档案</el-button>
      <el-button v-if="detail.profileLocked" type="warning" size="small" @click="unlockProfile">解锁修改（30分钟）</el-button>
      <el-button type="danger" plain size="small" @click="resaleVisible = true">房屋转售</el-button>
    </div>

    <el-row :gutter="16" style="margin-top: 12px">
      <el-col :span="12">
        <el-card>
          <template #header>1. 当前业主</template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="姓名">{{ detail.name }}</el-descriptions-item>
            <el-descriptions-item label="住户类型">{{ residentLabels[detail.residentType] ?? detail.residentType }}</el-descriptions-item>
            <el-descriptions-item label="房屋性质">
              <el-select
                :model-value="detail.propertyType || PropertyType.RESIDENTIAL"
                size="small"
                style="width: 120px"
                @change="(v: string) => updatePropertyType(v)"
              >
                <el-option :value="PropertyType.RESIDENTIAL" :label="propertyLabels[PropertyType.RESIDENTIAL]" />
                <el-option :value="PropertyType.COMMERCIAL_L1" :label="propertyLabels[PropertyType.COMMERCIAL_L1]" />
                <el-option :value="PropertyType.COMMERCIAL_L2" :label="propertyLabels[PropertyType.COMMERCIAL_L2]" />
              </el-select>
            </el-descriptions-item>
            <el-descriptions-item label="所属项目">{{ detail.projectName || detail.projectId }}</el-descriptions-item>
            <el-descriptions-item label="房号">{{ detail.roomNo }}</el-descriptions-item>
            <el-descriptions-item label="电话">{{ detail.phoneMasked }}</el-descriptions-item>
            <el-descriptions-item label="身份证号">{{ detail.idCardMasked || '—' }}</el-descriptions-item>
            <el-descriptions-item label="房屋面积">{{ (detail.houseAreaFen / 100).toFixed(2) }} ㎡</el-descriptions-item>
            <el-descriptions-item label="房屋状态">{{ statusLabels[detail.houseStatus] ?? detail.houseStatus }}</el-descriptions-item>
            <el-descriptions-item label="物业费起始">{{ detail.feeStartDate }}</el-descriptions-item>
            <el-descriptions-item label="装修时间">{{ detail.decorateDate ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="交房时间">{{ detail.deliveryDate ? formatDateTime(detail.deliveryDate) : '未交房' }}</el-descriptions-item>
            <el-descriptions-item label="合同签约">{{ detail.contractDate ?? '—' }}</el-descriptions-item>
          </el-descriptions>

          <template v-if="detail.relatedProperties?.length">
            <el-divider>同一手机号下的其他房源（跨项目）</el-divider>
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
          <div class="plate-tags">
            <el-tag v-for="p in detail.plates" :key="p" style="margin-right: 8px; margin-bottom: 6px">{{ p }}</el-tag>
            <span v-if="!detail.plates?.length" class="plate-empty">暂无车牌</span>
          </div>
          <div class="plate-form">
            <el-radio-group v-model="plateForm.kind" size="small">
              <el-radio-button value="fuel">油车</el-radio-button>
              <el-radio-button value="nev">新能源</el-radio-button>
            </el-radio-group>
            <el-select
              v-model="plateForm.province"
              filterable
              placeholder="省"
              style="width: 88px"
              size="small"
            >
              <el-option v-for="p in plateProvinces" :key="p" :label="p" :value="p" />
            </el-select>
            <el-select
              v-model="plateForm.letter"
              filterable
              placeholder="字母"
              style="width: 78px"
              size="small"
            >
              <el-option v-for="l in plateLetters" :key="l" :label="l" :value="l" />
            </el-select>
            <el-input
              v-model="plateForm.suffix"
              :placeholder="plateForm.kind === 'nev' ? '后 6 位（字母数字）' : '后 5 位（字母数字）'"
              :maxlength="plateForm.kind === 'nev' ? 6 : 5"
              style="width: 160px"
              size="small"
              @input="onPlateSuffixInput"
              @keyup.enter="addPlate"
            />
            <el-button type="primary" size="small" @click="addPlate">登记车牌</el-button>
            <span v-if="composedPlate" class="plate-preview">预览 {{ composedPlate }}</span>
          </div>

          <el-divider>房屋状态流转</el-divider>
          <p v-if="detail.houseStatus === 'UNDELIVERED'" class="status-tip">
            未交房仅能通过「交房缴费」变为已交房；转售不会改变交房状态。
          </p>
          <el-select
            v-else
            v-model="targetStatus"
            placeholder="目标状态"
            style="width: 140px; margin-right: 8px"
          >
            <el-option
              v-for="s in allowedNextStatuses"
              :key="s"
              :label="statusLabels[s] ?? s"
              :value="s"
            />
          </el-select>
          <el-button
            v-if="detail.houseStatus !== 'UNDELIVERED'"
            type="primary"
            size="small"
            @click="transitionStatus"
          >
            变更状态
          </el-button>
        </el-card>

        <el-card style="margin-top: 16px">
          <template #header>3. 装修报备</template>
          <el-alert
            v-if="detail.vacantEligible"
            type="success"
            :closable="false"
            title="当前为未交房/未装修：可享空置房优惠；装修报备后将变为已装修并取消空置优惠"
            style="margin-bottom: 12px"
          />
          <el-alert
            v-else
            type="warning"
            :closable="false"
            title="房屋已装修：不可再享空置房优惠"
            style="margin-bottom: 12px"
          />
          <el-alert
            :type="detail.depositDeductAllowed ? 'success' : 'info'"
            :closable="false"
            :title="detail.depositDeductAllowed ? '已有有效装修报备：允许押金抵扣' : '未装修报备：不可押金抵扣'"
            style="margin-bottom: 12px"
          />
          <el-form inline>
            <el-form-item label="开始日期">
              <el-date-picker v-model="filingForm.startDate" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="结束日期">
              <el-date-picker v-model="filingForm.endDate" type="date" value-format="YYYY-MM-DD" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="filingForm.remark" style="width: 140px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="createFiling">登记报备</el-button>
            </el-form-item>
          </el-form>
          <el-table :data="detail.decorateFilings ?? []" size="small" border>
            <el-table-column prop="startDate" label="开始" width="110" />
            <el-table-column prop="endDate" label="结束" width="110" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">{{ decorateStatusLabel(row.status) }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" />
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <el-button v-if="row.status === 'active'" link type="danger" @click="closeFiling(row.id)">关闭</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card>
          <template #header>2. 计费总览（本房源一体）</template>
          <el-descriptions :column="2" border v-if="feeStatus">
            <el-descriptions-item label="计费起始月">{{ feeStatus.feeStartMonth }}</el-descriptions-item>
            <el-descriptions-item label="计费截止月">{{ feeStatus.feeEndMonth }}</el-descriptions-item>
            <el-descriptions-item label="适用单价">
              {{ ((feeStatus.unitPrice ?? 0) / 100).toFixed(2) }} 元/㎡/月
              （{{ propertyLabels[feeStatus.propertyType] ?? '住房' }}）
            </el-descriptions-item>
            <el-descriptions-item label="累计计费月数">{{ feeStatus.totalBillableMonths }}</el-descriptions-item>
            <el-descriptions-item label="累计已缴费月数">{{ feeStatus.paidMonths }}</el-descriptions-item>
            <el-descriptions-item label="累计欠费月份">
              <el-tag :type="feeStatus.arrearsMonths > 0 ? 'danger' : 'success'">{{ feeStatus.arrearsMonths }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="欠费金额">
              <span class="amount">{{ (feeStatus.arrearsAmount / 100).toFixed(2) }} 元</span>
            </el-descriptions-item>
          </el-descriptions>
          <el-divider>已缴月段（跟房源，转售后仍保留）</el-divider>
          <el-tag v-for="(l, i) in feeStatus?.paidLedgers ?? []" :key="i" type="info" style="margin: 0 8px 8px 0">
            {{ l.startMonth }} ~ {{ l.endMonth }}（{{ l.months }}个月）
          </el-tag>
          <el-empty v-if="!(feeStatus?.paidLedgers?.length)" description="暂无缴费台账" :image-size="48" />
        </el-card>

        <el-card style="margin-top: 16px">
          <template #header>4. 历史业主（转售）</template>
          <el-timeline v-if="detail.ownershipHistory?.length">
            <el-timeline-item
              v-for="h in detail.ownershipHistory"
              :key="h.id"
              :timestamp="formatDateTime(h.transferredAt)"
            >
              {{ h.fromName }}（{{ h.fromIdCardMasked || '无证件' }}）→ {{ h.toName }}（{{ h.toIdCardMasked || '无证件' }}）
              <span v-if="h.remark">；{{ h.remark }}</span>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="无转售记录，缴费信息始终归属本房源" :image-size="48" />
        </el-card>

        <el-card style="margin-top: 16px">
          <template #header>5. 变更历史</template>
          <el-timeline>
            <el-timeline-item
              v-for="log in changeLogs"
              :key="log.id"
              :timestamp="formatDateTime(log.changedAt)"
            >
              {{ fieldLabel(log.fieldName) }}：{{ formatLogValue(log.oldValue) }} → {{ formatLogValue(log.newValue) }}
            </el-timeline-item>
          </el-timeline>
          <el-empty v-if="changeLogs.length === 0" description="暂无变更记录" :image-size="48" />
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="resaleVisible" title="房屋转售（缴费台账继承本房源）" width="520">
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px" title="转售后新业主需重新确认档案；历史缴费仍保留在本房源。" />
      <el-form :model="resaleForm" label-width="100px">
        <el-form-item label="新业主姓名" required>
          <el-input v-model="resaleForm.name" />
        </el-form-item>
        <el-form-item label="电话" required>
          <el-input v-model="resaleForm.phone" />
        </el-form-item>
        <el-form-item label="身份证号">
          <el-input v-model="resaleForm.idCard" maxlength="18" placeholder="可选" />
        </el-form-item>
        <el-form-item label="住户类型">
          <el-radio-group v-model="resaleForm.residentType">
            <el-radio v-for="(label, v) in residentLabels" :key="v" :value="v">{{ label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="合同日">
          <el-date-picker v-model="resaleForm.contractDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="resaleForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resaleVisible = false">取消</el-button>
        <el-button type="primary" @click="submitResale">确认转售</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  HOUSE_STATUS_LABELS,
  HouseStatus,
  HouseStatusTransitionMatrix,
  PROPERTY_TYPE_LABELS,
  PropertyType,
  RESIDENT_TYPE_LABELS,
  ResidentType,
} from '@pms/shared';
import { http } from '@/api/request';
import { decorateStatusLabel, fieldLabel, formatDateTime } from '@/utils/format';

const route = useRoute();
const customerId = computed(() => Number(route.params.id));
const detail = ref<Record<string, any> | null>(null);
const feeStatus = ref<Record<string, any> | null>(null);
const changeLogs = ref<Record<string, any>[]>([]);
const targetStatus = ref('');
const statusLabels = HOUSE_STATUS_LABELS;
const residentLabels = RESIDENT_TYPE_LABELS;
const propertyLabels = PROPERTY_TYPE_LABELS;
const allowedNextStatuses = computed(() => {
  const cur = detail.value?.houseStatus as HouseStatus | undefined;
  if (!cur) return [] as HouseStatus[];
  return (HouseStatusTransitionMatrix[cur] ?? []).filter(
    (s) => s !== HouseStatus.UNDELIVERED && s !== ('DELIVERED' as HouseStatus),
  );
});

const plateProvinces = [
  '京', '津', '沪', '渝', '冀', '豫', '云', '辽', '黑', '湘', '皖', '鲁', '新', '苏', '浙', '赣',
  '鄂', '桂', '甘', '晋', '蒙', '陕', '吉', '闽', '贵', '粤', '青', '藏', '川', '宁', '琼',
];
const plateLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('');
const plateForm = reactive({
  kind: 'fuel' as 'fuel' | 'nev',
  province: '湘',
  letter: 'A',
  suffix: '',
});
const composedPlate = computed(() => {
  const suffix = plateForm.suffix.trim().toUpperCase();
  if (!plateForm.province || !plateForm.letter || !suffix) return '';
  return `${plateForm.province}${plateForm.letter}${suffix}`;
});

function onPlateSuffixInput(val: string) {
  plateForm.suffix = String(val ?? '')
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z0-9挂学警港澳]/g, '');
}

function isValidPlateNoLocal(plate: string, kind: 'fuel' | 'nev'): boolean {
  if (kind === 'fuel') {
    return /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4}[A-HJ-NP-Z0-9挂学警港澳]$/.test(plate);
  }
  // 新能源：8 位，第二位字母后共 6 位
  return /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-HJ-NP-Z][A-HJ-NP-Z0-9]{5}[A-HJ-NP-Z0-9]$/.test(plate);
}
const resaleVisible = ref(false);
const filingForm = reactive({ startDate: '', endDate: '', remark: '' });
const resaleForm = reactive({
  name: '',
  phone: '',
  idCard: '',
  residentType: ResidentType.OWNER as string,
  contractDate: '',
  remark: '',
});

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

async function confirmProfile() {
  try {
    await http.post(`/customers/${customerId.value}/confirm-profile`);
    ElMessage.success('档案已确认锁定');
    await load();
  } catch {
    /* interceptor */
  }
}

async function unlockProfile() {
  try {
    await http.post(`/customers/${customerId.value}/unlock-profile`);
    ElMessage.success('已临时解锁，请尽快完成修改');
    await load();
  } catch {
    /* interceptor */
  }
}

async function submitResale() {
  if (!resaleForm.name || !resaleForm.phone) {
    ElMessage.warning('请填写新业主姓名与手机号');
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(resaleForm.phone)) {
    ElMessage.warning('手机号格式不正确');
    return;
  }
  try {
    await http.post(`/customers/${customerId.value}/resale`, {
      ...resaleForm,
      idCard: resaleForm.idCard.trim() || undefined,
      contractDate: resaleForm.contractDate || undefined,
      remark: resaleForm.remark || undefined,
    });
    ElMessage.success('转售完成，缴费台账已保留在本房源');
    resaleVisible.value = false;
    await load();
  } catch {
    /* interceptor */
  }
}

async function updatePropertyType(propertyType: string) {
  try {
    await http.patch(`/customers/${customerId.value}`, { propertyType });
    const tip =
      propertyType === PropertyType.COMMERCIAL_L2
        ? '已设为门面二楼（物业费面积×0.7）'
        : propertyType === PropertyType.COMMERCIAL_L1 || propertyType === PropertyType.COMMERCIAL
          ? '已设为门面一楼（物业费面积×2）'
          : '已设为住房';
    ElMessage.success(tip);
    await load();
  } catch {
    /* interceptor */
  }
}

async function createFiling() {
  if (!filingForm.startDate) {
    ElMessage.warning('请选择装修开始日期');
    return;
  }
  try {
    await http.post(`/customers/${customerId.value}/decorate-filings`, {
      startDate: filingForm.startDate,
      endDate: filingForm.endDate || undefined,
      remark: filingForm.remark || undefined,
    });
    ElMessage.success('装修报备已登记');
    filingForm.startDate = '';
    filingForm.endDate = '';
    filingForm.remark = '';
    await load();
  } catch {
    /* interceptor */
  }
}

async function closeFiling(filingId: number) {
  try {
    await http.post(`/customers/${customerId.value}/decorate-filings/${filingId}/close`, {});
    ElMessage.success('报备已关闭');
    await load();
  } catch {
    /* interceptor */
  }
}

async function addPlate() {
  const plateNo = composedPlate.value;
  if (!plateNo) {
    ElMessage.warning('请完整填写车牌号');
    return;
  }
  const needLen = plateForm.kind === 'nev' ? 6 : 5;
  if (plateForm.suffix.trim().length !== needLen) {
    ElMessage.warning(plateForm.kind === 'nev' ? '新能源车牌后半段须为 6 位' : '油车牌后半段须为 5 位');
    return;
  }
  if (!isValidPlateNoLocal(plateNo, plateForm.kind)) {
    ElMessage.warning('车牌号格式不正确，请核对');
    return;
  }
  try {
    await http.post(`/customers/${customerId.value}/plates`, { plateNo });
    ElMessage.success(`车牌 ${plateNo} 登记成功`);
    plateForm.suffix = '';
    await load();
  } catch {
    /* interceptor */
  }
}

async function transitionStatus() {
  if (!targetStatus.value) return;
  try {
    await http.post(`/customers/${customerId.value}/house-status`, { target: targetStatus.value });
    ElMessage.success('房屋状态已变更');
    await load();
  } catch {
    /* interceptor */
  }
}

function formatLogValue(v: unknown): string {
  if (v == null || v === '') return '—';
  const s = String(v);
  if (s === 'true' || s === 'false') return s === 'true' ? '是' : '否';
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return formatDateTime(s);
  if (statusLabels[s as keyof typeof statusLabels]) return statusLabels[s as keyof typeof statusLabels];
  if (residentLabels[s as keyof typeof residentLabels]) return residentLabels[s as keyof typeof residentLabels];
  if (propertyLabels[s as keyof typeof propertyLabels]) return propertyLabels[s as keyof typeof propertyLabels];
  return s;
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
.amount { color: #f56c6c; font-weight: bold; }
.plate-tags { min-height: 28px; margin-bottom: 8px; }
.plate-empty { color: var(--el-text-color-secondary); font-size: 13px; }
.plate-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.plate-preview {
  font-size: 13px;
  color: var(--el-color-primary);
  letter-spacing: 0.5px;
}
.status-tip {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
