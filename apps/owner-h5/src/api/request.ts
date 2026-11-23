import axios from 'axios';
import { showToast } from 'vant';

/** 业主端 axios：短期令牌注入与过期处理 */
export const http = axios.create({ baseURL: '/api/v1', timeout: 15000 });

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('pms_owner_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data;
      if (body.code === 'PMS-1002') {
        localStorage.removeItem('pms_owner_token');
        showToast(body.message || '身份验证已过期，请重新验证');
        window.location.hash = '#/verify';
        return Promise.reject(body);
      }
      showToast(body.message || '操作失败');
      return Promise.reject(body);
    }
    return body;
  },
  (error) => {
    const body = error.response?.data;
    showToast(body?.message || error.message || '网络异常');
    return Promise.reject(body ?? error);
  },
);