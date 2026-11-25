import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { ElMessage } from 'element-plus';
import { useProjectStore } from '@/stores/project';

/**
 * 业务页统一使用顶部「当前项目」，不再各自放项目下拉。
 */
export function useCurrentProject(opts?: { onChange?: (id: number | null) => void }) {
  const projectStore = useProjectStore();
  const { currentProjectId, options } = storeToRefs(projectStore);
  const currentProject = computed(() => projectStore.currentProject);
  const projectName = computed(() => currentProject.value?.name ?? (currentProjectId.value ? `项目 #${currentProjectId.value}` : '未选择项目'));

  function requireProjectId(): number | null {
    if (!currentProjectId.value) {
      ElMessage.warning('请先在顶部选择物业项目');
      return null;
    }
    return currentProjectId.value;
  }

  if (opts?.onChange) {
    watch(currentProjectId, (id) => opts.onChange?.(id ?? null));
  }

  return {
    projectStore,
    currentProjectId,
    currentProject,
    projectName,
    options,
    requireProjectId,
  };
}
