const path = require('path');
const Database = require('better-sqlite3');
const dbPath = process.argv[2] || path.join(__dirname, '../data/pms.db');
const db = new Database(dbPath, { readonly: true });

function dump(label, s) {
  console.log(
    label,
    s,
    [...String(s)].map((ch) => `${ch}:U+${ch.codePointAt(0).toString(16).toUpperCase()}`).join(' '),
  );
}

for (const c of db.prepare('SELECT id, name FROM company').all()) dump(`company#${c.id}`, c.name);
for (const p of db.prepare('SELECT id, name FROM project').all()) dump(`project#${p.id}`, p.name);
console.log('from chars', [...'桌信'].map((ch) => `U+${ch.codePointAt(0).toString(16).toUpperCase()}`).join(' '));
db.close();
