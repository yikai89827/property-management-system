const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '../data/pms.db');
const target = '株洲卓信物业管理有限责任公司';
const db = new Database(dbPath);

console.log('before', db.prepare('SELECT id, name FROM company').all());
db.prepare("UPDATE company SET name = replace(name, '桌信', '卓信') WHERE name LIKE '%桌信%'").run();
const one = db.prepare('SELECT id, name FROM company LIMIT 1').get();
if (one && !String(one.name).includes('卓信')) {
  db.prepare('UPDATE company SET name = ? WHERE id = ?').run(target, one.id);
}
console.log('after', db.prepare('SELECT id, name FROM company').all());
db.close();
