import { DataSource } from 'typeorm';
import { appDataSource } from '../database/data-source';

/** DataSource 全局持有者（供非模块注入场景使用，如 Guard/Subscriber） */
let holder: DataSource | null = null;

export function setDataSource(ds: DataSource): void {
  holder = ds;
}

export async function getDataSource(): Promise<DataSource> {
  if (!holder) {
    if (!appDataSource.isInitialized) {
      await appDataSource.initialize();
    }
    holder = appDataSource;
  }
  return holder;
}