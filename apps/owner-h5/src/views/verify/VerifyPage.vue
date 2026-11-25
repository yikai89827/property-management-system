<template>
  <div class="verify-page">
    <van-nav-bar title="业主/租户身份验证" />
    <div class="form">
      <van-notice-bar wrapable :scrollable="false" :text="noticeText" />
      <van-cell-group inset>
        <van-field
          :model-value="projectDisplay"
          label="缴费小区"
          readonly
          is-link
          required
          :placeholder="projectLoading ? '加载中…' : '请选择或扫描二维码自动带入'"
          @click="openProjectPicker"
        />
        <van-field
          v-model="form.phone"
          label="手机号"
          type="tel"
          placeholder="登记手机号（主识别）"
          maxlength="11"
          required
        />
        <van-field
          v-model="form.name"
          label="姓名（可选）"
          placeholder="一人多房时建议填写"
        />
        <van-field
          v-model="form.roomId"
          label="房号（可选）"
          placeholder="一人多房时填写以消歧"
        />
        <van-field
          v-model="form.idCard"
          label="身份证（可选）"
          placeholder="有身份证时可填"
          maxlength="18"
        />
      </van-cell-group>

      <van-cell-group v-if="candidates.length" inset class="candidates">
        <van-cell title="请选择要缴费的房屋" />
        <van-cell
          v-for="c in candidates"
          :key="c.customerId"
          :title="`${c.roomNo}（${residentLabel(c.residentType)}）`"
          :label="c.projectName"
          is-link
          @click="selectProperty(c.customerId)"
        />
      </van-cell-group>

      <van-button
        type="primary"
        block
        round
        :loading="loading"
        :disabled="!resolvedProjectId"
        class="submit"
        @click="handleVerify()"
      >
        验证并查看欠费
      </van-button>
      <van-collapse v-model="compatOpen">
        <van-collapse-item title="兼容旧方式：房号+姓名+手机后四位" name="1">
          <van-field v-model="legacy.roomId" label="房号" placeholder="如 1-101" />
          <van-field v-model="legacy.name" label="姓名" placeholder="与档案登记一致" />
          <van-field v-model="legacy.phoneLast4" label="手机后四位" maxlength="4" />
          <van-button
            size="small"
            type="primary"
            block
            :loading="loading"
            :disabled="!resolvedProjectId"
            @click="handleLegacy"
          >
            兼容验证
          </van-button>
        </van-collapse-item>
      </van-collapse>
    </div>

    <van-popup v-model:show="projectPickerVisible" position="bottom" round>
      <div class="picker-head">
        <span>选择缴费小区</span>
        <van-button size="small" type="primary" plain @click="projectPickerVisible = false">关闭</van-button>
      </div>
      <van-search v-model="projectKeyword" placeholder="搜索小区名称 / 地址" />
      <van-radio-group :model-value="resolvedProjectId ?? undefined">
        <van-cell-group>
          <van-cell
            v-for="p in filteredProjects"
            :key="p.id"
            clickable
            :title="p.name"
            :label="p.address || `项目编号 ${p.id}`"
            @click="selectProject(p)"
          >
            <template #right-icon>
              <van-radio :name="p.id" />
            </template>
          </van-cell>
        </van-cell-group>
      </van-radio-group>
      <van-empty v-if="!filteredProjects.length" description="暂无匹配小区" :image-size="64" />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast } from 'vant';
import axios from 'axios';

const PROJECT_KEY = 'pms_owner_project_id';
const PROJECT_NAME_KEY = 'pms_owner_project_name';

interface ProjectBrief {
  id: number;
  name: string;
  address: string;
}

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const projectLoading = ref(false);
const projectPickerVisible = ref(false);
const projectKeyword = ref('');
const projectOptions = ref<ProjectBrief[]>([]);
const compatOpen = ref<string[]>([]);
const resolvedProjectId = ref<number | null>(null);
const projectName = ref('');
const projectAddress = ref('');
const candidates = ref<
  { customerId: number; roomNo: string; residentType: string; projectName: string; houseStatus: string }[]
>([]);
const form = reactive({ phone: '', name: '', roomId: '', idCard: '' });
const legacy = reactive({ roomId: '', name: '', phoneLast4: '' });

const projectDisplay = computed(() => {
  if (!resolvedProjectId.value) return '';
  if (projectName.value) {
    return projectAddress.value
      ? `${projectName.value}（${projectAddress.value}）`
      : projectName.value;
  }
  return `项目 #${resolvedProjectId.value}`;
});

const noticeText = computed(() =>
  resolvedProjectId.value
    ? `已带入「${projectName.value || '项目 ' + resolvedProjectId.value}」。请用登记手机号验证；一人多房时补填姓名或房号。`
    : '请扫描项目缴费二维码自动带入小区，也可手动选择其他小区。',
);

const filteredProjects = computed(() => {
  const kw = projectKeyword.value.trim().toLowerCase();
  if (!kw) return projectOptions.value;
  return projectOptions.value.filter(
    (p) =>
      p.name.toLowerCase().includes(kw) ||
      (p.address || '').toLowerCase().includes(kw) ||
      String(p.id).includes(kw),
  );
});

function residentLabel(type: string) {
  return type === 'TENANT' ? '租户' : '业主';
}

function readProjectIdFromUrl(): number | null {
  const fromHash = Number(route.query.project ?? route.query.projectId ?? 0);
  if (Number.isInteger(fromHash) && fromHash > 0) return fromHash;
  const search = new URLSearchParams(window.location.search);
  const fromSearch = Number(search.get('project') ?? search.get('projectId') ?? 0);
  if (Number.isInteger(fromSearch) && fromSearch > 0) return fromSearch;
  const cached = Number(localStorage.getItem(PROJECT_KEY) ?? 0);
  if (Number.isInteger(cached) && cached > 0) return cached;
  return null;
}

function persistProject(id: number, name?: string) {
  localStorage.setItem(PROJECT_KEY, String(id));
  if (name) localStorage.setItem(PROJECT_NAME_KEY, name);
}

async function loadProjectOptions() {
  try {
    const res = await axios.get('/api/v1/owner/projects/briefs');
    const body = res.data;
    projectOptions.value = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  } catch {
    projectOptions.value = [];
  }
}

function applyProject(p: ProjectBrief) {
  resolvedProjectId.value = p.id;
  projectName.value = p.name;
  projectAddress.value = p.address || '';
  persistProject(p.id, p.name);
  candidates.value = [];
}

async function selectProject(p: ProjectBrief) {
  applyProject(p);
  projectPickerVisible.value = false;
  if (String(route.query.project) !== String(p.id)) {
    await router.replace({ path: '/verify', query: { ...route.query, project: String(p.id) } });
  }
  showToast(`已切换至 ${p.name}`);
}

async function openProjectPicker() {
  if (!projectOptions.value.length) {
    projectLoading.value = true;
    await loadProjectOptions();
    projectLoading.value = false;
  }
  if (!projectOptions.value.length) {
    showToast('暂无可选小区');
    return;
  }
  projectKeyword.value = '';
  projectPickerVisible.value = true;
}

async function bindInitialProject(id: number) {
  projectLoading.value = true;
  try {
    if (!projectOptions.value.length) await loadProjectOptions();
    const found = projectOptions.value.find((p) => p.id === id);
    if (found) {
      applyProject(found);
    } else {
      const res = await axios.get(`/api/v1/owner/projects/${id}/brief`);
      const body = res.data;
      if (body.code !== 0 || !body.data) {
        showToast(body.message || '项目不存在，请手动选择小区');
        resolvedProjectId.value = null;
        return;
      }
      applyProject(body.data);
    }
    if (String(route.query.project) !== String(id)) {
      await router.replace({ path: '/verify', query: { ...route.query, project: String(id) } });
    }
  } catch {
    showToast('无法识别扫码小区，请手动选择');
    resolvedProjectId.value = null;
  } finally {
    projectLoading.value = false;
  }
}

async function handleVerify(customerId?: number) {
  if (!resolvedProjectId.value) {
    showToast('请先选择缴费小区');
    return;
  }
  const phone = form.phone.trim();
  const idCard = form.idCard.trim().toUpperCase();
  if (!phone && !idCard) {
    showToast('请填写手机号（推荐）或身份证号');
    return;
  }
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
    showToast('手机号格式不正确');
    return;
  }
  loading.value = true;
  try {
    const res = await axios.post('/api/v1/owner/auth/verify', {
      projectId: String(resolvedProjectId.value),
      phone: phone || undefined,
      idCard: idCard || undefined,
      name: form.name.trim() || undefined,
      roomId: form.roomId || undefined,
      customerId,
    });
    const body = res.data;
    if (body.code !== 0) {
      showToast(body.message || '客户信息不匹配，请核对后重试');
      return;
    }
    if (body.data.needSelectProperty) {
      candidates.value = body.data.properties ?? [];
      showToast('检测到多套房源，请选择');
      return;
    }
    localStorage.setItem('pms_owner_token', body.data.ownerToken);
    localStorage.setItem('pms_owner_brief', JSON.stringify(body.data.customerBrief));
    if (body.data.allProperties) {
      localStorage.setItem('pms_owner_properties', JSON.stringify(body.data.allProperties));
    }
    showToast({ type: 'success', message: '验证成功' });
    router.push('/arrears');
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    showToast(message || '客户信息不匹配，请核对后重试');
  } finally {
    loading.value = false;
  }
}

function selectProperty(customerId: number) {
  void handleVerify(customerId);
}

async function handleLegacy() {
  if (!resolvedProjectId.value) {
    showToast('请先选择缴费小区');
    return;
  }
  if (!legacy.roomId || !legacy.name || legacy.phoneLast4.length !== 4) {
    showToast('请完整填写房号、姓名与手机号后四位');
    return;
  }
  loading.value = true;
  try {
    const res = await axios.post('/api/v1/owner/auth/verify', {
      projectId: String(resolvedProjectId.value),
      roomId: legacy.roomId,
      name: legacy.name,
      phoneLast4: legacy.phoneLast4,
    });
    const body = res.data;
    if (body.code !== 0) {
      showToast(body.message || '客户信息不匹配，请核对后重试');
      return;
    }
    localStorage.setItem('pms_owner_token', body.data.ownerToken);
    localStorage.setItem('pms_owner_brief', JSON.stringify(body.data.customerBrief));
    showToast({ type: 'success', message: '验证成功' });
    router.push('/arrears');
  } catch (e: unknown) {
    const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
    showToast(message || '客户信息不匹配，请核对后重试');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadProjectOptions();
  const id = readProjectIdFromUrl();
  if (id) {
    await bindInitialProject(id);
    return;
  }
  projectName.value = localStorage.getItem(PROJECT_NAME_KEY) ?? '';
});
</script>

<style scoped>
.form { padding: 16px 0 24px; }
.submit { margin: 24px 16px; width: calc(100% - 32px); }
.candidates { margin-top: 12px; }
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
  font-size: 15px;
  font-weight: 600;
}
</style>
