/**
 * 清理重复公司，只保留一条「株洲卓信物业管理有限责任公司」，避免 seed 启动崩溃。
 */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '../data/pms.db');
const TARGET = '株洲卓信物业管理有限责任公司';
const FROM = '桌信';
const TO = '卓信';

const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');

const companies = db.prepare('SELECT id, name FROM company ORDER BY id').all();
console.log('before', companies);

let keep = companies.find((c) => c.name === TARGET);
if (!keep) {
  keep = companies.find((c) => String(c.name).includes(FROM) || String(c.name).includes(TO)) || companies[0];
  if (keep) {
    db.prepare('UPDATE company SET name = ? WHERE id = ?').run(TARGET, keep.id);
    console.log('set primary', keep.id, TARGET);
  }
}
const keepId = keep?.id;
if (!keepId) {
  console.error('no company');
  process.exit(1);
}

for (const c of companies) {
  if (c.id === keepId) continue;
  // 迁移带 company_id 的表（忽略唯一冲突行）
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
  for (const table of tables) {
    if (table === 'company') continue;
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((x) => x.name);
    if (!cols.includes('company_id')) continue;
    try {
      const rows = db.prepare(`SELECT rowid AS rid FROM "${table}" WHERE company_id = ?`).all(c.id);
      for (const row of rows) {
        try {
          db.prepare(`UPDATE "${table}" SET company_id = ? WHERE rowid = ?`).run(keepId, row.rid);
        } catch {
          // unique conflict: drop orphan row under duplicate company
          try {
            db.prepare(`DELETE FROM "${table}" WHERE rowid = ?`).run(row.rid);
          } catch {}
        }
      }
    } catch {}
  }
  try {
    db.prepare('DELETE FROM company WHERE id = ?').run(c.id);
    console.log('deleted company', c.id, c.name);
  } catch (e) {
    db.prepare('UPDATE company SET name = ? WHERE id = ?').run(`${TARGET}-removed-${c.id}`, c.id);
    console.log('rename stuck company', c.id, e.message);
  }
}

// 再清一次桌信
for (const p of db.prepare('SELECT id, name FROM project').all()) {
  if (String(p.name).includes(FROM)) {
    let next = String(p.name).split(FROM).join(TO);
    const clash = db.prepare('SELECT id FROM project WHERE company_id=? AND name=? AND id!=?').get(keepId, next, p.id);
    if (clash) next = `${next}-${p.id}`;
    db.prepare('UPDATE project SET name = ? WHERE id = ?').run(next, p.id);
  }
}

console.log('after', db.prepare('SELECT id, name FROM company').all());
db.close();
