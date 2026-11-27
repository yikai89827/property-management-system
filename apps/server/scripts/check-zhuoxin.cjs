const path = require('path');
const Database = require('better-sqlite3');
const dbPath = process.argv[2] || path.join(__dirname, '../data/pms.db');
const db = new Database(dbPath, { readonly: true });
const FROM = '桌信';
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
let left = 0;
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all();
  for (const c of cols) {
    try {
      const n = db
        .prepare(
          `SELECT COUNT(*) AS c FROM "${t.name.replace(/"/g, '""')}" WHERE instr(CAST("${c.name.replace(/"/g, '""')}" AS TEXT), ?) > 0`,
        )
        .get(FROM);
      if (n.c) {
        left += n.c;
        console.log(`${t.name}.${c.name}: ${n.c}`);
      }
    } catch {}
  }
}
console.log('remaining_rows', left);
console.log('company', db.prepare('SELECT id, name FROM company').all());
console.log('projects', db.prepare('SELECT id, name FROM project').all());
db.close();
