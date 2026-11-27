/**
 * 全库「桌信」→「卓信」。遇唯一约束时：项目名追加 -id；重复公司迁移后删除。
 * 用法: node scripts/fix-zhuoxin.cjs [dbPath]
 */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '../data/pms.db');
const FROM = '\u684c\u4fe1'; // 桌信
const TO = '\u5353\u4fe1'; // 卓信
const TARGET_COMPANY = `\u682a\u6d32${TO}\u7269\u4e1a\u7ba1\u7406\u6709\u9650\u8d23\u4efb\u516c\u53f8`;

const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');

function qIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

const report = [];
let totalChanges = 0;

const tx = db.transaction(() => {
  // 1) 通用文本列替换（company/project 名称单独处理）
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);

  for (const table of tables) {
    if (table === 'company' || table === 'project') continue;
    const cols = db.prepare(`PRAGMA table_info(${qIdent(table)})`).all();
    for (const col of cols) {
      try {
        const rows = db
          .prepare(
            `SELECT rowid AS rid, ${qIdent(col.name)} AS val FROM ${qIdent(table)} WHERE instr(CAST(${qIdent(col.name)} AS TEXT), ?) > 0`,
          )
          .all(FROM);
        const upd = db.prepare(`UPDATE ${qIdent(table)} SET ${qIdent(col.name)} = ? WHERE rowid = ?`);
        let n = 0;
        for (const row of rows) {
          const next = String(row.val).split(FROM).join(TO);
          if (next === row.val) continue;
          upd.run(next, row.rid);
          n += 1;
        }
        if (n) {
          totalChanges += n;
          report.push({ table, column: col.name, rows: n });
        }
      } catch {
        // skip
      }
    }
  }

  // 2) 项目名
  for (const p of db.prepare('SELECT id, company_id, name FROM project').all()) {
    if (!String(p.name).includes(FROM)) continue;
    let next = String(p.name).split(FROM).join(TO);
    const clash = db
      .prepare('SELECT id FROM project WHERE company_id = ? AND name = ? AND id != ?')
      .get(p.company_id, next, p.id);
    if (clash) next = `${next}-${p.id}`;
    db.prepare('UPDATE project SET name = ? WHERE id = ?').run(next, p.id);
    totalChanges += 1;
    report.push({ table: 'project', id: p.id, to: next });
  }

  // 3) 公司名：主公司固定为目标名；重复「桌信」公司迁数据后删除
  let keep = db.prepare('SELECT id FROM company WHERE name = ?').get(TARGET_COMPANY);
  const typoCompanies = db
    .prepare('SELECT id, name FROM company WHERE instr(name, ?) > 0')
    .all(FROM);

  if (!keep && typoCompanies.length) {
    const first = typoCompanies[0];
    db.prepare('UPDATE company SET name = ? WHERE id = ?').run(TARGET_COMPANY, first.id);
    keep = { id: first.id };
    totalChanges += 1;
    report.push({ table: 'company', action: 'rename_primary', id: first.id });
  }

  const keepId = keep?.id;
  for (const c of typoCompanies) {
    if (keepId && c.id === keepId) {
      if (c.name !== TARGET_COMPANY) {
        db.prepare('UPDATE company SET name = ? WHERE id = ?').run(TARGET_COMPANY, c.id);
        totalChanges += 1;
        report.push({ table: 'company', action: 'fix_keep', id: c.id });
      }
      continue;
    }
    if (!keepId) continue;

    // 迁移常见表的 company_id
    const migrateTables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all()
      .map((r) => r.name);
    for (const table of migrateTables) {
      if (table === 'company') continue;
      const cols = db.prepare(`PRAGMA table_info(${qIdent(table)})`).all().map((x) => x.name);
      if (!cols.includes('company_id')) continue;
      try {
        const r = db
          .prepare(`UPDATE ${qIdent(table)} SET company_id = ? WHERE company_id = ?`)
          .run(keepId, c.id);
        if (r.changes) report.push({ table, action: 'migrate_company_id', from: c.id, to: keepId, rows: r.changes });
      } catch (e) {
        // 项目名冲突等：逐条处理
        if (table === 'project') {
          for (const p of db.prepare('SELECT id, name FROM project WHERE company_id = ?').all(c.id)) {
            let name = String(p.name).split(FROM).join(TO);
            const clash = db
              .prepare('SELECT id FROM project WHERE company_id = ? AND name = ?')
              .get(keepId, name);
            if (clash) name = `${name}-${p.id}`;
            db.prepare('UPDATE project SET company_id = ?, name = ? WHERE id = ?').run(keepId, name, p.id);
            report.push({ table: 'project', action: 'migrate', id: p.id, name });
          }
        } else {
          report.push({ table, action: 'migrate_failed', error: String(e.message || e) });
        }
      }
    }

    try {
      db.prepare('DELETE FROM company WHERE id = ?').run(c.id);
      totalChanges += 1;
      report.push({ table: 'company', action: 'deleted_duplicate', id: c.id });
    } catch (e) {
      const alt = `${TARGET_COMPANY}-dup${c.id}`;
      db.prepare('UPDATE company SET name = ? WHERE id = ?').run(alt, c.id);
      totalChanges += 1;
      report.push({ table: 'company', action: 'renamed_stuck_dup', id: c.id, to: alt, error: String(e.message || e) });
    }
  }

  // 4) 再扫一遍兜底
  for (const table of tables) {
    const cols = db.prepare(`PRAGMA table_info(${qIdent(table)})`).all();
    for (const col of cols) {
      try {
        const rows = db
          .prepare(
            `SELECT rowid AS rid, ${qIdent(col.name)} AS val FROM ${qIdent(table)} WHERE instr(CAST(${qIdent(col.name)} AS TEXT), ?) > 0`,
          )
          .all(FROM);
        for (const row of rows) {
          const next = String(row.val).split(FROM).join(TO);
          if (next === row.val) continue;
          try {
            db.prepare(`UPDATE ${qIdent(table)} SET ${qIdent(col.name)} = ? WHERE rowid = ?`).run(next, row.rid);
            totalChanges += 1;
          } catch {
            // ignore unique leftovers
          }
        }
      } catch {
        // skip
      }
    }
  }
});

tx();

console.log(JSON.stringify({ dbPath, totalChanges, report }, null, 2));
console.log('company', db.prepare('SELECT id, name FROM company').all());
console.log('projects', db.prepare('SELECT id, company_id, name FROM project ORDER BY id').all());
const leftP = db.prepare('SELECT COUNT(*) AS c FROM project WHERE instr(name, ?) > 0').get(FROM).c;
const leftC = db.prepare('SELECT COUNT(*) AS c FROM company WHERE instr(name, ?) > 0').get(FROM).c;
console.log('remaining_project', leftP, 'remaining_company', leftC);
db.close();
process.exit(leftP + leftC > 0 ? 2 : 0);
