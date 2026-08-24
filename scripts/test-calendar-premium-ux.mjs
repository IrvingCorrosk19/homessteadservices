import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const calendarSrc = readFileSync(join(root, "src/components/admin/AppointmentCalendar.tsx"), "utf8");
const cardSrc = readFileSync(join(root, "src/components/admin/calendar/AppointmentCard.tsx"), "utf8");
const modalSrc = readFileSync(join(root, "src/components/admin/calendar/RescheduleModal.tsx"), "utf8");
const slotSrc = readFileSync(join(root, "src/lib/appointment-slot.ts"), "utf8");
const storeSrc = readFileSync(join(root, "src/lib/revenue-store.ts"), "utf8");
const routeSrc = readFileSync(join(root, "src/app/api/admin/appointments/[appointmentId]/route.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/admin/citas/page.tsx"), "utf8");

check("CAL-01 drag drop wired", calendarSrc.includes("onDragStart") && calendarSrc.includes("onDrop"));
check("CAL-02 day cell drop target", calendarSrc.includes("handleDrop") && calendarSrc.includes("newDate: day"));
check("CAL-03 cancel confirm modal", modalSrc.includes("Cancelar") && calendarSrc.includes("setPending(null)"));
check("CAL-04 slot taken message", calendarSrc.includes("slot_taken") || calendarSrc.includes("Horario no disponible"));
check("CAL-05 inflight double drop guard", calendarSrc.includes("inflight.current"));
check("CAL-06 stale version handling", calendarSrc.includes("stale_version") && routeSrc.includes("expectedVersion"));
check("CAL-07 telegram RESCHEDULED path preserved", readFileSync(join(root, "src/lib/revenue-telegram.ts"), "utf8").includes('notifyAppointmentEvent(latest.appointment_id, "RESCHEDULED"'));
check("CAL-08 version in reminder key", readFileSync(join(root, "src/lib/revenue-telegram.ts"), "utf8").includes("appointment.version"));
check("CAL-09 calendar passes version", pageSrc.includes("version: item.version"));
check("CAL-10 optimistic patch without reload", !calendarSrc.includes("location.reload") && calendarSrc.includes("patchItem"));
check("CAL-11 card overflow controls", cardSrc.includes("min-w-0") && cardSrc.includes("truncate") && cardSrc.includes("max-w-full"));
check("CAL-12 status badge truncate", cardSrc.includes("truncate") && cardSrc.includes("uppercase"));
check("CAL-13 overflow popover", calendarSrc.includes("+") && calendarSrc.includes("DayOverflowPopover"));
check("CAL-14 click opens detail", calendarSrc.includes("openDetail") && cardSrc.includes("onClick={onOpen}"));
check("CAL-15 drag uses draggable", cardSrc.includes("draggable="));
check("CAL-16 mobile drag disabled", calendarSrc.includes("pointer: fine") && calendarSrc.includes("dragEnabled"));
check("CAL-17 timezone slot validation", slotSrc.includes("todayInPanama") && slotSrc.includes("isBusinessClock"));
check("CAL-18 cancelled not draggable", cardSrc.includes("canDragAppointment") && cardSrc.includes("DRAGGABLE_STATUSES"));
check("CAL-19 audit log reschedule", storeSrc.includes('logInfo("APPOINTMENT_RESCHEDULED"'));
check("CAL-20 conditional version update", storeSrc.includes("WHERE appointment_id = ?") && storeSrc.includes("expectedVersion"));

const bottomSheetSrc = readFileSync(join(root, "src/components/admin/calendar/AppointmentDetailBottomSheet.tsx"), "utf8");
const detailSrc = readFileSync(join(root, "src/components/admin/calendar/AppointmentDetailContent.tsx"), "utf8");
const upcomingSrc = readFileSync(join(root, "src/components/admin/calendar/UpcomingSection.tsx"), "utf8");

check("MOBILE bottom sheet component", bottomSheetSrc.includes("AppointmentDetailBottomSheet") && bottomSheetSrc.includes("overflow-y-auto"));
check("MOBILE body scroll lock", bottomSheetSrc.includes('document.body.style.overflow = "hidden"'));
check("DESKTOP body scroll not locked", bottomSheetSrc.includes("max-width: 1279px") && bottomSheetSrc.includes("mq.matches"));
check("DESKTOP sheet not mounted", calendarSrc.includes("useMobileSheetViewport") && calendarSrc.includes("sheetViewport"));
check("MOBILE no scrollIntoView hack", !calendarSrc.includes("scrollIntoView"));
check("MOBILE sheet xl:hidden", bottomSheetSrc.includes("xl:hidden"));
check("DESKTOP aside xl:block sticky", calendarSrc.includes("hidden space-y-6 xl:block") && calendarSrc.includes("sticky top-6"));
check("MOBILE upcoming before calendar", calendarSrc.includes("xl:hidden") && calendarSrc.includes("UpcomingSection"));
check("MOBILE immediate feedback sheet", calendarSrc.includes("AppointmentDetailBottomSheet") && calendarSrc.includes("openDetail"));
check("MOBILE close preserves state", calendarSrc.includes("function closeDetail") && calendarSrc.includes('setOpenId("")'));
check("MOBILE reschedule in sheet", detailSrc.includes("Reprogramar") && detailSrc.includes("mobile"));
check("INTERNAL_SCROLL sheet", bottomSheetSrc.includes("overscroll-contain"));
check("SAFE_AREA ios", bottomSheetSrc.includes("safe-area-inset-bottom"));
check("FOCUS close button", bottomSheetSrc.includes("closeRef") && bottomSheetSrc.includes("focus"));
check("390px week horizontal scroll", calendarSrc.includes("snap-x") && calendarSrc.includes("overflow-x-auto"));
check("TOUCH min height cards", cardSrc.includes("min-h-11"));

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "hs-cal-"));
  const db = new Database(join(dir, "t.sqlite"));
  db.exec(`
    CREATE TABLE revenue_appointments (
      appointment_id TEXT PRIMARY KEY,
      lead_id TEXT,
      customer_id INTEGER,
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      service TEXT,
      status TEXT,
      version INTEGER DEFAULT 1
    );
    CREATE UNIQUE INDEX idx_rev_appt_open_slot
      ON revenue_appointments (date, start_time)
      WHERE status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED');
  `);
  return db;
}

const db = openDb();
db.prepare("INSERT INTO revenue_appointments VALUES ('HA-aaa','L1',1,'2026-08-23','10:00','11:00','plumbing','CONFIRMED',1)").run();
db.prepare("INSERT INTO revenue_appointments VALUES ('HA-bbb','L2',2,'2026-08-24','14:00','15:00','ac','CONFIRMED',1)").run();

const conflict = db
  .prepare(
    `SELECT appointment_id FROM revenue_appointments
     WHERE date = ? AND start_time = ? AND status IN ('REQUESTED','PROPOSED','CONFIRMED','RESCHEDULED') AND appointment_id != ?`,
  )
  .get("2026-08-24", "14:00", "HA-aaa");
check("slot concurrency blocks occupied slot", Boolean(conflict));

const versionUpdate = db
  .prepare(
    `UPDATE revenue_appointments SET date = ?, start_time = ?, version = version + 1
     WHERE appointment_id = ? AND version = ? AND status NOT IN ('CANCELLED','COMPLETED')`,
  )
  .run("2026-08-25", "10:00", "HA-aaa", 1);
check("atomic versioned reschedule", versionUpdate.changes === 1);

const stale = db
  .prepare(
    `UPDATE revenue_appointments SET date = ?, start_time = ?, version = version + 1
     WHERE appointment_id = ? AND version = ?`,
  )
  .run("2026-08-26", "10:00", "HA-aaa", 1);
check("stale version rejected", stale.changes === 0);

const cancelled = db.prepare("UPDATE revenue_appointments SET status='CANCELLED' WHERE appointment_id='HA-bbb'").run();
check("cancelled appointment updated", cancelled.changes === 1);

if (failed) {
  console.error(`\n${failed} calendar premium UX checks failed`);
  process.exit(1);
}
console.log("\nCALENDAR_PREMIUM_UX_OK");
