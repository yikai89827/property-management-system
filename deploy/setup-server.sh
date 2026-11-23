#!/usr/bin/env bash
set -euo pipefail

echo "==> 系统依赖"
dnf install -y nginx git tar gcc-c++ make python3 openssl which curl

# Node 20（Alibaba Cloud Linux 等非标准 RPM 发行版用官方二进制）
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  echo "==> 安装 Node.js 20"
  if curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && dnf install -y nodejs; then
    :
  else
    NODE_VER=v20.18.1
    curl -fsSL "https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-linux-x64.tar.xz" -o /tmp/node20.tar.xz
    tar -xJf /tmp/node20.tar.xz -C /usr/local --strip-components=1
    rm -f /tmp/node20.tar.xz
  fi
fi

corepack enable || true
npm install -g pnpm@9 pm2 --force

# 小内存机器加 swap，避免构建 OOM
if [[ ! -f /swapfile ]]; then
  echo "==> 创建 2G swap"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
fi

mkdir -p /opt/pms /var/log/pms /opt/pms/apps/server/data
echo "==> 运行时准备完成: node=$(node -v) pnpm=$(pnpm -v)"
