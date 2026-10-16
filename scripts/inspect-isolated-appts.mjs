import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const db = new Database(join(process.cwd(), "data", "control-test", "homestead.sqlite"));
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%appoint%'`)
  .all();
console.log("tables", tables);
for (const t of tables) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get().n;
  console.log(t.name, "rows", n);
  if (n) {
    console.log(db.prepare(`SELECT * FROM ${t.name} ORDER BY rowid DESC LIMIT 8`).all());
  }
}
db.close();
