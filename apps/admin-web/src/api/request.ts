import axios from 'axios';
import { ElMessage } from 'element-plus';

/** 统一 axios 实例：Bearer Token 注入、统一响应体解包、按 code 提示、401 跳登录 */
export const http = axios.create({ baseURL: '/api/v1', timeout: 15000 });

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('pms_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data;
      if (body.code === 'PMS-1002' || response.status === 401) {
        localStorage.removeItem('pms_access_token');
        ElMessage.error(body.message || '登录已失效，请重新登录');
        if (window.location.hash !== '#/login') window.location.hash = '#/login';
        return Promise.reject(body);
      }
      ElMessage.error(body.message || '操作失败');
      return Promise.reject(body);
    }
    return body;
  },
  (error) => {
    const body = error.response?.data;
    const message = body?.message || error.message || '网络异常';
    if (error.response?.status === 401) {
      localStorage.removeItem('pms_access_token');
      window.location.hash = '#/login';
    }
    ElMessage.error(message);
    return Promise.reject(body ?? error);
  },
);