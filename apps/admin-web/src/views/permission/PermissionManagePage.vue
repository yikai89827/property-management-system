<template>
  <el-card>
    <template #header>权限管理（仅公司管理员可见）</template>
    <el-tabs v-model="tab">
      <el-tab-pane label="员工账号" name="users">
        <el-button type="primary" style="margin-bottom: 12px" @click="openCreateUser">新建员工账号</el-button>
        <el-table :data="users" border>
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="username" label="用户名" />
          <el-table-column prop="realName" label="姓名" />
          <el-table-column prop="roles" label="角色">
            <template #default="{ row }">{{ formatRoles(row.roles) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="数据范围" min-width="120">
            <template #default="{ row }">{{ row.allProjectsScope ? '全部项目' : `授权 ${row.projectScopes?.length ?? 0} 个项目` }}</template>
          </el-table-column>
          <el-table-column label="最近登录时间" width="170">
            <template #default="{ row }">
              <span v-if="row.lastLoginAt">{{ formatDateTime(row.lastLoginAt) }}</span>
              <el-tag v-else type="info" size="small" effect="plain">从未登录</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="360">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditUser(row)">编辑</el-button>
              <el-button link type="warning" @click="openResetPassword(row)">重置密码</el-button>
              <el-button link type="primary" @click="openPermissions(row)">配置权限</el-button>
              <el-popconfirm :title="row.status === 'active' ? '停用后该账号登录态立即失效（离职生效路径）' : '恢复该账号？'" @confirm="toggleUser(row)">
                <template #reference>
                  <el-button link :type="row.status === 'active' ? 'danger' : 'success'">
                    {{ row.status === 'active' ? '停用' : '启用' }}
                  </el-button>
                </template>
              </el-popconfirm>
              <el-popconfirm
                v-if="row.canDelete"
                title="确认删除该未使用账号？删除后不可恢复"
                @confirm="deleteUser(row)"
              >
                <template #reference>
                  <el-button link type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="角色管理" name="roles">
        <el-table :data="roles" border table-layout="auto" style="width: 100%">
          <el-table-column prop="code" label="编码" min-width="160" />
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column label="类型" min-width="140" width="160">
            <template #default="{ row }">
              <el-tag v-if="row.builtIn" type="warning" effect="plain">内置（禁删）</el-tag>
              <el-tag v-else type="info" effect="plain">自定义</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="审计日志" name="audit">
        <el-table :data="auditLogs" border>
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="actionType" label="操作类型" width="160" />
          <el-table-column prop="result" label="结果" width="100" />
          <el-table-column label="内容">
            <template #default="{ row }">
              <span class="audit-content">{{ row.actionContent?.slice(0, 120) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="userDialogVisible" :title="editingUserId ? '编辑账户信息' : '新建员工账号'" width="480">
      <el-form :model="userForm" label-width="100px">
        <el-form-item label="用户名" required>
          <el-input v-model="userForm.username" :disabled="!!editingUserId" placeholder="登录账号，创建后不可改" />
        </el-form-item>
        <el-form-item :label="editingUserId ? '新密码' : '初始密码'" :required="!editingUserId">
          <el-input
            v-model="userForm.password"
            type="password"
            show-password
            :placeholder="editingUserId ? '留空则不修改密码' : '至少 6 位'"
          />
        </el-form-item>
        <el-form-item label="姓名" required>
          <el-input v-model="userForm.realName" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="userForm.roleCodes" multiple style="width: 100%" placeholder="请选择角色">
            <el-option v-for="r in roles" :key="r.code" :label="r.name" :value="r.code" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="editingUserId ? saveEditUser() : createUser()">
          {{ editingUserId ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetPwdVisible" title="重置密码" width="420">
      <p class="reset-tip">账号：{{ resetTarget?.username }}（{{ resetTarget?.realName }}）</p>
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="新密码" required>
          <el-input
            v-model="resetPassword"
            type="password"
            show-password
            placeholder="至少 6 位"
            maxlength="64"
          />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input
            v-model="resetPasswordConfirm"
            type="password"
            show-password
            placeholder="再次输入新密码"
            maxlength="64"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPwdVisible = false">取消</el-button>
        <el-button type="primary" @click="submitResetPassword">确认重置</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="permDrawerVisible" :title="`权限配置：${editingUser?.realName ?? ''}`" size="520">
      <h4>权限点覆盖（允许/拒绝）</h4>
      <el-table :data="permissionRows" border size="small" max-height="420">
        <el-table-column prop="name" label="权限点" />
        <el-table-column prop="type" label="类型" width="100" />
        <el-table-column label="覆盖" width="160">
          <template #default="{ row }">
            <el-select v-model="row.override" size="small">
              <el-option label="跟随角色" value="" />
              <el-option label="允许" value="allow" />
              <el-option label="拒绝" value="deny" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <h4 style="margin-top: 16px">项目数据范围</h4>
      <el-checkbox v-model="allProjectsScope">全部项目</el-checkbox>
      <el-select v-if="!allProjectsScope" v-model="scopeProjectIds" multiple style="width: 100%">
        <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <div style="margin-top: 16px; text-align: right">
        <el-button type="primary" @click="savePermissions">保存（立即生效）</el-button>
      </div>
    </el-drawer>
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { http } from '@/api/request';
import { formatDateTime } from '@/utils/format';

const tab = ref('users');
const users = ref<Record<string, any>[]>([]);
const roles = ref<Record<string, any>[]>([]);
const auditLogs = ref<Record<string, any>[]>([]);
const projects = ref<{ id: number; name: string }[]>([]);
const userDialogVisible = ref(false);
const editingUserId = ref<number | null>(null);
const resetPwdVisible = ref(false);
const resetTarget = ref<Record<string, any> | null>(null);
const resetPassword = ref('');
const resetPasswordConfirm = ref('');
const permDrawerVisible = ref(false);
const userForm = reactive({ username: '', password: '', realName: '', roleCodes: [] as string[] });
const editingUser = ref<Record<string, any> | null>(null);
const permissionRows = ref<Record<string, any>[]>([]);
const allProjectsScope = ref(false);
const scopeProjectIds = ref<number[]>([]);

function formatRoles(roles: Array<string | { code?: string; name?: string }> | undefined) {
  if (!roles?.length) return '—';
  return roles
    .map((r) => (typeof r === 'string' ? r : r.name || r.code || ''))
    .filter(Boolean)
    .join('、');
}


async function load() {
  users.value = await http.get<never, Record<string, any>[]>('/users');
  roles.value = await http.get<never, Record<string, any>[]>('/roles');
  const audit = await http.get<never, { list: Record<string, any>[] }>('/audit-logs');
  auditLogs.value = audit.list;
  const p = await http.get<never, { list: { id: number; name: string }[] }>('/projects', { params: { pageSize: 100 } });
  projects.value = p.list;
}

function openCreateUser() {
  editingUserId.value = null;
  Object.assign(userForm, { username: '', password: '', realName: '', roleCodes: [] });
  userDialogVisible.value = true;
}

function openEditUser(row: Record<string, any>) {
  editingUserId.value = row.id;
  const roleCodes = (row.roles ?? [])
    .map((r: string | { code?: string }) => (typeof r === 'string' ? r : r.code))
    .filter(Boolean) as string[];
  Object.assign(userForm, {
    username: row.username ?? '',
    password: '',
    realName: row.realName ?? '',
    roleCodes,
  });
  userDialogVisible.value = true;
}

async function createUser() {
  if (!userForm.username || userForm.password.length < 6 || !userForm.realName || userForm.roleCodes.length === 0) {
    ElMessage.warning('请完整填写（密码至少 6 位，至少一个角色）');
    return;
  }
  await http.post('/users', userForm);
  ElMessage.success('员工账号创建成功');
  userDialogVisible.value = false;
  await load();
}

async function saveEditUser() {
  if (!editingUserId.value) return;
  if (!userForm.realName?.trim()) {
    ElMessage.warning('姓名不能为空');
    return;
  }
  if (userForm.roleCodes.length === 0) {
    ElMessage.warning('至少选择一个角色');
    return;
  }
  if (userForm.password && userForm.password.length < 6) {
    ElMessage.warning('新密码至少 6 位');
    return;
  }
  const payload: Record<string, unknown> = {
    realName: userForm.realName.trim(),
    roleCodes: userForm.roleCodes,
  };
  if (userForm.password) payload.password = userForm.password;
  await http.patch(`/users/${editingUserId.value}`, payload);
  ElMessage.success('账户信息已更新');
  userDialogVisible.value = false;
  editingUserId.value = null;
  await load();
}

async function toggleUser(row: Record<string, any>) {
  await http.patch(`/users/${row.id}`, { status: row.status === 'active' ? 'disabled' : 'active' });
  ElMessage.success(row.status === 'active' ? '已停用（该账号登录态立即失效）' : '已启用');
  await load();
}

async function deleteUser(row: Record<string, any>) {
  await http.delete(`/users/${row.id}`);
  ElMessage.success('账号已删除');
  await load();
}

function openResetPassword(row: Record<string, any>) {
  resetTarget.value = row;
  resetPassword.value = '';
  resetPasswordConfirm.value = '';
  resetPwdVisible.value = true;
}

async function submitResetPassword() {
  if (!resetTarget.value) return;
  if (!resetPassword.value || resetPassword.value.length < 6) {
    ElMessage.warning('新密码至少 6 位');
    return;
  }
  if (resetPassword.value !== resetPasswordConfirm.value) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }
  await http.patch(`/users/${resetTarget.value.id}`, { password: resetPassword.value });
  ElMessage.success('密码已重置');
  resetPwdVisible.value = false;
  resetTarget.value = null;
}

async function openPermissions(row: Record<string, any>) {
  editingUser.value = row;
  const [perms, current] = await Promise.all([
    http.get<never, Record<string, any>[]>('/permissions'),
    http.get<never, Record<string, any>>(`/users/${row.id}/permissions`),
  ]);
  const overrideMap = new Map<string, string>(
    (current.overrides ?? []).map((o: Record<string, any>) => [o.permissionCode, o.overrideType]),
  );
  permissionRows.value = perms.map((p) => ({
    code: p.code,
    name: p.name,
    type: p.type === 'operation' ? '操作' : '查询项',
    override: overrideMap.get(p.code) ?? '',
  }));
  allProjectsScope.value = current.allProjectsScope ?? false;
  scopeProjectIds.value = current.projectScopes ?? [];
  permDrawerVisible.value = true;
}

/** 保存授权（授权/回收下一次请求立即生效） */
async function savePermissions() {
  if (!editingUser.value) return;
  const overrides = permissionRows.value
    .filter((r) => r.override)
    .map((r) => ({ permissionCode: r.code, overrideType: r.override }));
  await http.put(`/users/${editingUser.value.id}/permissions`, { overrides });
  await http.put(`/users/${editingUser.value.id}/project-scopes`, {
    allProjectsScope: allProjectsScope.value,
    projectIds: scopeProjectIds.value,
  });
  ElMessage.success('权限配置已保存，下一次请求立即生效');
  permDrawerVisible.value = false;
  await load();
}

onMounted(load);
</script>

<style scoped>
.audit-content { font-size: 12px; color: #606266; }
.reset-tip {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>