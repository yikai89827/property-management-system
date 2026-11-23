#!/usr/bin/env bash
# 远端发布：覆盖代码 → 安装依赖 → 构建 → 刷新静态资源 → 重启 API
# 保留 apps/server/.env 与 apps/server/data（业务库不丢）
set -euo pipefail

ROOT=/opt/pms
TGZ=/tmp/pms-deploy.tgz
STAGING=/tmp/pms-release-staging
PRESERVE=/tmp/pms-preserve

if [[ ! -f "${TGZ}" ]]; then
  echo "缺少 ${TGZ}，请先从本机上传"
  exit 1
fi

echo "==> 备份生产 .env / data"
rm -rf "${PRESERVE}"
mkdir -p "${PRESERVE}"
[[ -f "${ROOT}/apps/server/.env" ]] && cp -a "${ROOT}/apps/server/.env" "${PRESERVE}/.env"
[[ -d "${ROOT}/apps/server/data" ]] && cp -a "${ROOT}/apps/server/data" "${PRESERVE}/data"

echo "==> 解压新版本"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"
tar -xzf "${TGZ}" -C "${STAGING}"
rm -f "${STAGING}/apps/server/.env" "${STAGING}/apps/server/.env."* 2>/dev/null || true
rm -rf "${STAGING}/apps/server/data"

# 尽量保留远端 node_modules 以加速；缺 rsync 时用 dnf 装一下
if ! command -v rsync >/dev/null 2>&1; then
  dnf install -y rsync >/dev/null 2>&1 || yum install -y rsync >/dev/null 2>&1 || true
fi

mkdir -p "${ROOT}"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'node_modules/' \
    --exclude 'apps/server/node_modules/' \
    --exclude 'apps/admin-web/node_modules/' \
    --exclude 'apps/owner-h5/node_modules/' \
    --exclude 'packages/shared/node_modules/' \
    --exclude 'www/' \
    --exclude 'apps/server/.env' \
    --exclude 'apps/server/data/' \
    "${STAGING}/" "${ROOT}/"
else
  # 无 rsync：整包覆盖（保留 node_modules / www）
  for item in "${STAGING}"/* "${STAGING}"/.[!.]*; do
    [[ -e "${item}" ]] || continue
    base=$(basename "${item}")
    [[ "${base}" == "node_modules" || "${base}" == "www" ]] && continue
    rm -rf "${ROOT}/${base}"
    cp -a "${item}" "${ROOT}/${base}"
  done
fi

echo "==> 恢复 .env / data"
mkdir -p "${ROOT}/apps/server/data"
[[ -f "${PRESERVE}/.env" ]] && cp -a "${PRESERVE}/.env" "${ROOT}/apps/server/.env"
[[ -d "${PRESERVE}/data" ]] && cp -a "${PRESERVE}/data/." "${ROOT}/apps/server/data/"

chmod +x "${ROOT}/deploy/"*.sh 2>/dev/null || true
sed -i 's/\r$//' "${ROOT}/deploy/"*.sh "${ROOT}/deploy/"*.cjs "${ROOT}/deploy/"*.conf 2>/dev/null || true

cd "${ROOT}"

echo "==> 安装依赖"
pnpm install --frozen-lockfile || pnpm install

echo "==> 构建"
export NODE_OPTIONS=--max-old-space-size=1024
pnpm --filter @pms/shared build
pnpm --filter @pms/server build
pnpm --filter @pms/admin-web build
pnpm --filter @pms/owner-h5 build

echo "==> 发布静态资源"
rm -rf "${ROOT}/www"
mkdir -p "${ROOT}/www/h5"
cp -a "${ROOT}/apps/admin-web/dist/." "${ROOT}/www/"
cp -a "${ROOT}/apps/owner-h5/dist/." "${ROOT}/www/h5/"

echo "==> 补齐生产 .env（仅缺失/开发机密钥时）"
ENV_FILE="${ROOT}/apps/server/.env"
need_env=0
if [[ ! -f "${ENV_FILE}" ]]; then
  need_env=1
elif grep -qE 'change-me|localhost:5171|0123456789abcdef' "${ENV_FILE}" 2>/dev/null; then
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

echo "==> 刷新 Nginx"
if [[ -f "${ROOT}/deploy/nginx-pms.conf" ]]; then
  cp "${ROOT}/deploy/nginx-pms.conf" /etc/nginx/conf.d/pms.conf
  nginx -t && systemctl reload nginx || systemctl restart nginx
fi

echo "==> 重启 PM2"
mkdir -p /var/log/pms
cd "${ROOT}"
if pm2 describe pms-server >/dev/null 2>&1; then
  pm2 restart pms-server --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save

echo "==> 健康检查"
sleep 3
curl -sf http://127.0.0.1:3000/api/v1/health && echo
curl -sf -o /dev/null -w "admin:%{http_code}\n" http://127.0.0.1/
curl -sf -o /dev/null -w "owner:%{http_code}\n" http://127.0.0.1/h5/

rm -rf "${STAGING}" "${TGZ}" "${PRESERVE}"
echo "发布完成"
