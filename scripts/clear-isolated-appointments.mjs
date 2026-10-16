import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const db = new Database(join(process.cwd(), "data", "control-test", "homestead.sqlite"));
const before = db
  .prepare(`SELECT appointment_id, date, start_time, status FROM revenue_appointments WHERE status != 'CANCELLED'`)
  .all();
console.log("before", before);
const info = db
  .prepare(
    `UPDATE revenue_appointments
     SET status = 'CANCELLED',
         notes = TRIM(COALESCE(notes, '') || ' [cleared-for-ui-booking]')
     WHERE status != 'CANCELLED'`,
  )
  .run();
console.log("cancelled", info.changes);
db.close();
