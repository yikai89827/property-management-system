#!/usr/bin/env bash
set -euo pipefail
cd /opt/pms

echo "==> 安装依赖"
pnpm install --frozen-lockfile || pnpm install

echo "==> 构建"
export NODE_OPTIONS=--max-old-space-size=1024
pnpm --filter @pms/shared build
pnpm --filter @pms/server build
pnpm --filter @pms/admin-web build
pnpm --filter @pms/owner-h5 build

echo "==> 发布静态资源到 /opt/pms/www"
rm -rf /opt/pms/www
mkdir -p /opt/pms/www/h5
cp -a /opt/pms/apps/admin-web/dist/. /opt/pms/www/
cp -a /opt/pms/apps/owner-h5/dist/. /opt/pms/www/h5/

echo "==> 配置环境变量"
mkdir -p /opt/pms/apps/server/data
ENV_FILE=/opt/pms/apps/server/.env
# 若上传了开发机 .env，或关键不完整，则生成生产配置（已有生产密钥则保留）
need_env=0
if [[ ! -f "${ENV_FILE}" ]]; then
  need_env=1
elif grep -qE 'change-me|localhost:5171|0123456789abcdef' "${ENV_FILE}" 2>/dev/null; then
  need_env=1
elif ! grep -q 'HOST=127.0.0.1' "${ENV_FILE}" 2>/dev/null; then
  need_env=1
fi
if [[ "${need_env}" -eq 1 ]]; then
  ENC=$(openssl rand -hex 32)
  BLIND=$(openssl rand -hex 32)
  JWT_A=$(openssl rand -hex 24)
  JWT_R=$(openssl rand -hex 24)
  cat > "${ENV_FILE}" <<EOF
PORT=3000
HOST=127.0.0.1
DATABASE_PATH=/opt/pms/apps/server/data/pms.db
DB_AUTO_SYNC=true
ENCRYPTION_KEY=${ENC}
BLIND_INDEX_KEY=${BLIND}
JWT_ACCESS_SECRET=${JWT_A}
JWT_REFRESH_SECRET=${JWT_R}
JWT_OWNER_TTL=7200
DEFAULT_COMPANY_NAME=株洲桌信物业管理有限责任公司
RECEIPT_NO_PREFIX=PM
H5_BASE_URL=http://8.163.8.22/h5
EOF
  echo "已生成 ${ENV_FILE}"
fi

echo "==> Nginx"
cp /opt/pms/deploy/nginx-pms.conf /etc/nginx/conf.d/pms.conf
rm -f /etc/nginx/conf.d/default.conf || true
# Alibaba Cloud Linux 可能启用了默认 server
if [[ -f /etc/nginx/nginx.conf ]]; then
  sed -i 's/default_server//g' /etc/nginx/nginx.conf || true
fi
nginx -t
systemctl enable --now nginx
systemctl restart nginx

echo "==> PM2 启动 API"
mkdir -p /var/log/pms
cd /opt/pms
# Nest 从 apps/server 读 .env
pm2 delete pms-server >/dev/null 2>&1 || true
pm2 start deploy/ecosystem.config.cjs
pm2 save
STARTUP_CMD=$(pm2 startup systemd -u root --hp /root | tail -n 1 || true)
if [[ "${STARTUP_CMD}" == sudo* ]] || [[ "${STARTUP_CMD}" == env* ]]; then
  eval "${STARTUP_CMD}" || true
fi

echo "==> 健康检查"
sleep 3
curl -sf http://127.0.0.1:3000/api/v1/health && echo
curl -sf -o /dev/null -w "admin:%{http_code}\n" http://127.0.0.1/
curl -sf -o /dev/null -w "owner:%{http_code}\n" http://127.0.0.1/h5/
echo "部署完成"
echo "管理端: http://8.163.8.22/"
echo "业主端: http://8.163.8.22/h5/"
echo "账号: admin / admin123"
echo "请在阿里云安全组放行 TCP 80"
