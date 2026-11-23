import { DataSource } from 'typeorm';
import { existsSync, readFileSync } from 'node:fs';

// 轻量 .env 解析（NestJS ConfigModule 在应用内负责环境变量；此处供独立脚本使用）
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

import { orgEntities } from './entities/org-entities';
import { chargingEntities } from './entities/charging-entities';
import { authEntities } from './entities/auth-entities';
import { phase2Entities } from './entities/phase2-entities';

export const allEntities = [...orgEntities, ...chargingEntities, ...authEntities, ...phase2Entities];

export function createDataSource(dbPath?: string): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: dbPath ?? process.env.DATABASE_PATH ?? './data/pms.db',
    entities: allEntities,
    // 一期开发环境自动同步建表（幂等）；生产环境置 DB_AUTO_SYNC=false 并使用迁移脚本
    synchronize: (process.env.DB_AUTO_SYNC ?? 'true') === 'true',
    logging: false,
    prepareDatabase: (db: import('better-sqlite3').Database) => {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
    },
  });
}

export const appDataSource = createDataSource();

/** 全局 DataSource 获取器（模块依赖注入使用） */
let initialized: DataSource | null = null;

export async function getInitializedDataSource(): Promise<DataSource> {
  if (!initialized) {
    initialized = appDataSource;
    if (!initialized.isInitialized) {
      await initialized.initialize();
    }
  }
  return initialized;
}