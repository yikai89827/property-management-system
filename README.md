# 物业管理系统（Property Management System）

三端一体的物业管理系统：**业主端**（扫码缴费 → 电子收据）、**项目端/管理端**（信息录入、缴费办理、统计查询）、**公司管理端**（权限管理、全项目统计），支持**多项目/多物业公司两级扩展**。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端（管理端） | Vue 3 + TypeScript + Element Plus + Pinia + Vue Router + Vite |
| 前端（业主端 H5） | Vue 3 + TypeScript + Vant 4 + Vite |
| 后端 | Node.js + NestJS 10 + TypeORM |
| 数据库 | SQLite（better-sqlite3，WAL 模式） |
| 工程 | pnpm monorepo（`apps/server`、`apps/admin-web`、`apps/owner-h5`、`packages/shared`） |

## 核心设计

- **金额全程整数（分）运算**：面积以 0.01㎡ 百分位整数参与运算，仅最终金额一步四舍五入，杜绝浮点误差
- **费用参数化 + 快照**：四项费用公式参数化（`fee_parameter` 版本化配置表），收款单固化开单时刻参数/项目名称快照——参数调整、项目改名**不影响历史单据**
- **月段台账**（`property_fee_ledger`）：已缴费月数/剩余应交费月份/重复缴费拦截的唯一事实来源，月段状态 pending/effective/void
- **多租户两级扩展**：所有表含 `company_id`，AsyncLocalStorage 租户上下文 + 订阅器自动填充，新增物业公司 = 纯数据操作零停机
- **敏感数据保护**：身份证/手机号 AES-256-GCM 密文 + HMAC-SHA256 盲索引双列存储，响应统一脱敏
- **权限即时生效**：RBAC + 项目数据范围双维授权，每请求实时查库（无缓存），越权写审计日志
- **一期收款登记模式**：业主端提交 → 收款单 pending + 月段预占（防重复支付）→ 收费员确认到账核销 / 驳回释放；预留 `PaymentChannelProvider` 支付渠道适配器（二期微信/支付宝）
- **二期框架预留**：工单/人力资源/增值服务建表契约 + 占位接口（PMS-9100）+ 菜单灰置

## 快速启动

```bash
# 1. 安装依赖（首次；pnpm 11 需在 pnpm-workspace.yaml 中 allowBuilds 放行原生依赖脚本）
pnpm install

# 2. 配置环境变量
cp .env.example apps/server/.env   # 按需修改密钥与公司名称

# 3. 构建共享包（已构建可跳过）
pnpm --filter @pms/shared build

# 4. 启动（推荐）
pnpm dev:server   # http://localhost:3000 ，Swagger：/api/docs
pnpm dev:admin    # http://localhost:5170
pnpm dev:owner    # http://localhost:5171

# 初始账号：admin / admin123（公司管理员，全部权限）
# 种子会创建演示项目「卓信花园」「滨江壹号」；业主/租户以身份证为公司内唯一身份，可跨多项目挂多套房源
```

### 二维码接入

管理端「项目管理 → 生成缴费二维码」按 `{H5_BASE}/#/verify?project={projectId}` 生成项目专属缴费二维码物料，业主扫码直达该项目的身份验证页。

## 测试

```bash
# 后端单元测试（费用引擎/身份证校验位/加密盲索引/状态机/发号器并发）
cd apps/server && npm test

# 后端集成冒烟（进程内：登录→建项目→建客户→预览→交房缴费→重复拦截→状态联动→业主验证→欠费→统计）
cd apps/server && node_modules/.bin/ts-node-transpile-only .tmp_smoke.ts

# 前端类型检查
cd apps/admin-web && npx vue-tsc --noEmit
cd apps/owner-h5 && npx vue-tsc --noEmit
```

## 数据库备份

SQLite 单文件 + WAL，使用 `VACUUM INTO` 做文件级在线备份：

```bash
sqlite3 apps/server/data/pms.db "VACUUM INTO 'backup/pms-$(date +%Y%m%d).db';"
```

建议每日定时备份；恢复时替换 `DATABASE_PATH` 指向的文件即可（迁移幂等，重启自动校验表结构）。

## 生产部署注意

- 置 `DB_AUTO_SYNC=false` 并使用迁移脚本建表（开发环境默认自动同步）
- 必须更换 `ENCRYPTION_KEY` / `BLIND_INDEX_KEY` / `JWT_*_SECRET`
- 收款单/审计表无 update/delete 路径（防篡改）；审计日志定期归档

## 目录结构

```
├── apps/
│   ├── server/          # NestJS 后端（API /api/v1）
│   │   ├── src/common/          # 横切：租户上下文/加密/守卫/审计拦截器/异常
│   │   ├── src/database/        # 数据源/实体（4 域）/种子
│   │   └── src/modules/         # auth/user/audit/project/customer/fee-*/charging/payment/owner/statistics/notification/phase2
│   ├── admin-web/       # 管理端（登录→动态权限路由→客户/缴费工作台/打印/统计/权限/配置）
│   └── owner-h5/        # 业主端 H5（验证→欠费→缴费登记→电子收据）
├── packages/shared/     # @pms/shared：枚举/错误码/权限点/状态机矩阵/DTO 契约
└── .codeartsdoer/specs/property_mgmt/   # spec.md / design.md / tasks.md（需求与设计文档）
```

## 二期路线（已预留）

工单系统（状态机契约已建表）、人力资源（考勤/费用审批/员工）、增值服务、公众号通知（`notification_outbox` + `NotificationChannel` 注册即投递）、微信/支付宝支付渠道（实现 `PaymentChannelProvider` 注册即可）。