/**
 * 一次性将公司名「桌信」更正为「卓信」。
 * 用法: node scripts/rename-company.mjs [dbPath]
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.argv[2] || process.env.DATABASE_PATH || path.join(__dirname, '../data/pms.db');
const target = '株洲卓信物业管理有限责任公司';

const db = new Database(dbPath);
const before = db.prepare('SELECT id, name FROM company').all();
console.log('before:', before);

const r = db
  .prepare(`UPDATE company SET name = ? WHERE name LIKE '%桌信%' OR name = ? OR name LIKE '%株洲卓信%'`)
  .run(target, target);

// 若仅有一条公司且名称不对，强制改名
const rows = db.prepare('SELECT id, name FROM company').all();
if (rows.length === 1 && rows[0].name !== target) {
  db.prepare('UPDATE company SET name = ? WHERE id = ?').run(target, rows[0].id);
  console.log('forced rename for company id', rows[0].id);
}

console.log('changes:', r.changes);
console.log('after:', db.prepare('SELECT id, name FROM company').all());
db.close();
