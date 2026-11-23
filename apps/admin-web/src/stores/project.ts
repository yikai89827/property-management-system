import { defineStore } from 'pinia';
import { http } from '@/api/request';

export interface ProjectOption {
  id: number;
  name: string;
  address: string;
  landArea: number;
}

const STORAGE_KEY = 'pms_current_project_id';

/** 全局当前项目上下文（多小区切换） */
export const useProjectStore = defineStore('project', {
  state: () => ({
    options: [] as ProjectOption[],
    currentProjectId: (Number(localStorage.getItem(STORAGE_KEY) || 0) || null) as number | null,
    loaded: false,
  }),
  getters: {
    currentProject: (s) => s.options.find((p) => p.id === s.currentProjectId) ?? null,
  },
  actions: {
    async loadOptions() {
      try {
        const list = await http.get<never, ProjectOption[]>('/projects/options/all');
        this.options = Array.isArray(list) ? list : [];
        if (this.currentProjectId && !this.options.some((p) => p.id === this.currentProjectId)) {
          this.currentProjectId = this.options[0]?.id ?? null;
        }
        if (!this.currentProjectId && this.options.length) {
          this.currentProjectId = this.options[0].id;
        }
        if (this.currentProjectId) {
          localStorage.setItem(STORAGE_KEY, String(this.currentProjectId));
        }
        this.loaded = true;
      } catch {
        this.options = [];
        this.loaded = true;
      }
    },
    setCurrent(id: number | null) {
      this.currentProjectId = id;
      if (id) localStorage.setItem(STORAGE_KEY, String(id));
      else localStorage.removeItem(STORAGE_KEY);
    },
  },
});
