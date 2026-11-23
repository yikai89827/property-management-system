import { defineStore } from 'pinia';
import { http } from '@/api/request';

export interface UserInfo {
  id: number;
  username: string;
  realName: string;
  companyName: string;
  permissions: string[];
  allProjectsScope: boolean;
  projectScopes: number[];
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: localStorage.getItem('pms_access_token') ?? '',
    refreshToken: localStorage.getItem('pms_refresh_token') ?? '',
    userInfo: null as UserInfo | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    hasPermission: (s) => (code: string) => s.userInfo?.permissions.includes(code) ?? false,
  },
  actions: {
    async login(username: string, password: string) {
      const data = await http.post<never, { accessToken: string; refreshToken: string }>('/auth/login', {
        username,
        password,
      });
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      localStorage.setItem('pms_access_token', data.accessToken);
      localStorage.setItem('pms_refresh_token', data.refreshToken);
    },
    async fetchUserInfo() {
      this.userInfo = await http.get<never, UserInfo>('/auth/me');
      return this.userInfo;
    },
    logout() {
      this.accessToken = '';
      this.refreshToken = '';
      this.userInfo = null;
      localStorage.removeItem('pms_access_token');
      localStorage.removeItem('pms_refresh_token');
    },
  },
});