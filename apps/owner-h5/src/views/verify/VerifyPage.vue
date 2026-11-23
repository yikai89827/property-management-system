<template>
  <div class="verify-page">
    <van-nav-bar title="业主/租户身份验证" />
    <div class="form">
      <van-notice-bar
        wrapable
        :scrollable="false"
        text="以身份证号作为唯一身份标识；同一人可在多个小区拥有房源。"
      />
      <van-cell-group inset>
        <van-field
          v-model="form.idCard"
          label="身份证号"
          placeholder="18 位身份证号"
          maxlength="18"
          required
        />
        <van-field
          v-model="form.roomId"
          label="房号（可选）"
          placeholder="一人多房时填写以消歧"
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

      <van-button type="primary" block round :loading="loading" class="submit" @click="handleVerify()">
        验证并查看欠费
      </van-button>
      <van-collapse v-model="compatOpen">
        <van-collapse-item title="兼容旧方式：房号+姓名+手机后四位" name="1">
          <van-field v-model="legacy.roomId" label="房号" placeholder="如 1-101" />
          <van-field v-model="legacy.name" label="姓名" placeholder="与档案登记一致" />
          <van-field v-model="legacy.phoneLast4" label="手机后四位" maxlength="4" />
          <van-button size="small" type="primary" block :loading="loading" @click="handleLegacy">兼容验证</van-button>
        </van-collapse-item>
      </van-collapse>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { showToast } from 'vant';
import axios from 'axios';

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const compatOpen = ref<string[]>([]);
const candidates = ref<
  { customerId: number; roomNo: string; residentType: string; projectName: string; houseStatus: string }[]
>([]);
const form = reactive({ idCard: '', roomId: '' });
const legacy = reactive({ roomId: '', name: '', phoneLast4: '' });

function residentLabel(type: string) {
  return type === 'TENANT' ? '租户' : '业主';
}

function projectId() {
  return Number(route.query.project ?? route.query.projectId ?? 1);
}

async function handleVerify(customerId?: number) {
  if (!form.idCard || form.idCard.length < 18) {
    showToast('请填写 18 位身份证号');
    return;
  }
  loading.value = true;
  try {
    const res = await axios.post('/api/v1/owner/auth/verify', {
      projectId: String(projectId()),
      idCard: form.idCard.trim().toUpperCase(),
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
  if (!legacy.roomId || !legacy.name || legacy.phoneLast4.length !== 4) {
    showToast('请完整填写房号、姓名与手机号后四位');
    return;
  }
  loading.value = true;
  try {
    const res = await axios.post('/api/v1/owner/auth/verify', {
      projectId: String(projectId()),
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
</script>

<style scoped>
.form { padding: 16px 0 24px; }
.submit { margin: 24px 16px; width: calc(100% - 32px); }
.candidates { margin-top: 12px; }
</style>
