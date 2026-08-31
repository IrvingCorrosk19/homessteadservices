/**
 * Referential language + cancel referent behavioral tests.
 */
import { resolveOfferedSlotReference, resolveCancelReferent } from "../src/lib/concierge/referential-resolver";
import { resolveSlotFromMessage } from "../src/lib/concierge-transaction";

const slots = [
  { date: "2026-08-31", time: "10:00", label: "10:00 a. m." },
  { date: "2026-08-31", time: "12:00", label: "12:00 p. m." },
  { date: "2026-08-31", time: "16:00", label: "4:00 p. m." },
];

let failed = 0;
function ok(name: string, value: boolean) {
  if (!value) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

ok("REF la segunda", resolveOfferedSlotReference("la segunda", slots).resolved?.time === "12:00");
ok("REF mediodía", resolveOfferedSlotReference("mediodía", slots).resolved?.time === "12:00");
ok("REF la de las 12", resolveSlotFromMessage("la de las 12", slots)?.time === "12:00");
ok("REF prefiero las 4", resolveSlotFromMessage("prefiero las 4", slots)?.time === "16:00");
ok("REF ese ambiguous", resolveOfferedSlotReference("ese", slots).needsClarification);
ok("CANCEL cita", resolveCancelReferent("cancela la cita", { appointmentId: "HA-1", activeLeadId: "HS-1" }).resolved === "appointment");
ok("CANCEL ambiguous", resolveCancelReferent("cancélalo", { appointmentId: "HA-1", activeLeadId: "HS-1" }).needsClarification);

if (failed) {
  console.error(`\nREFERENTIAL TESTS FAILED (${failed})`);
  process.exit(1);
}
console.log("\nREFERENTIAL TESTS PASS");
