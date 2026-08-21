import assert from "node:assert/strict";

function parseDurationMs(value) {
  const match = String(value || "")
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(h|m|d)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (match[2] === "d") return amount * 24 * 60 * 60 * 1000;
  if (match[2] === "h") return amount * 60 * 60 * 1000;
  return amount * 60 * 1000;
}

function dueReminderOffset(remainingMs, offsets) {
  if (remainingMs <= 0) return null;
  const sorted = [...offsets].sort((a, b) => b.ms - a.ms);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    const minRemaining = next ? next.ms : 0;
    if (remainingMs > minRemaining && remainingMs <= current.ms) return current;
  }
  return null;
}

function zonedLocalToUtcMs(ymd, hm, timeZone) {
  const time = hm.length === 5 ? `${hm}:00` : hm;
  const utcGuess = Date.parse(`${ymd}T${time}Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  const asIf = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  return utcGuess + (utcGuess - asIf);
}

const offsets = [
  { label: "24h", ms: parseDurationMs("24h") },
  { label: "2h", ms: parseDurationMs("2h") },
];

assert.equal(parseDurationMs("24h"), 24 * 3600000);
assert.equal(dueReminderOffset(10 * 3600000, offsets)?.label, "24h");
assert.equal(dueReminderOffset(90 * 60000, offsets)?.label, "2h");
assert.equal(dueReminderOffset(-1000, offsets), null);
assert.equal(dueReminderOffset(30 * 3600000, offsets), null);

const panama = zonedLocalToUtcMs("2026-08-21", "15:30", "America/Panama");
assert.equal(new Date(panama).toISOString(), "2026-08-21T20:30:00.000Z");

const notice = ["HA-abc", "REMINDER", "1", "2h:2026-08-21:15:30"].join(":");
const replay = ["HA-abc", "REMINDER", "1", "2h:2026-08-21:15:30"].join(":");
assert.equal(notice, replay);

console.log("APPOINTMENT_TIME_TESTS_OK");
