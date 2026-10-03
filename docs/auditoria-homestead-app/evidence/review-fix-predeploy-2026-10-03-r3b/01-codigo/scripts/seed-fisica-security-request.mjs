/**
 * Seed a fictitious NEW request with securityReviewRequired=false for physical A06.
 * Uses control-dev isolation only — never production. Run with: npx tsx <this>
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyControlIsolatedEnv, assertSafeToMutateControlDev } from "./control-isolated-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = applyControlIsolatedEnv(root, "dev");
assertSafeToMutateControlDev(dataDir, "seed-fisica-security");

const { getHomesteadDb, saveServiceRequest } = await import("../src/lib/service-requests.ts");
getHomesteadDb();
const { assertIsolatedSecretsCleared, isControlIsolated } = await import("../src/lib/control-isolation.ts");
assertIsolatedSecretsCleared();
if (!isControlIsolated()) throw new Error("not_isolated");

const stamp = Date.now().toString(36);
const created = saveServiceRequest({
  name: `Ficticia A06 ${stamp}`,
  phone: `+5076${String(Date.now()).slice(-7)}`,
  email: `sec-fisica-${stamp}@example.invalid`,
  property: "house",
  service: "locksmith",
  message: `Solicitud ficticia marca seguridad A06 ${stamp}`,
  photos: [],
  isTest: true,
});

const row = getHomesteadDb()
  .prepare(
    `SELECT public_id, status, COALESCE(security_review_required,0) AS flag,
            COALESCE(security_review_reason,'') AS reason
     FROM service_requests WHERE public_id = ?`,
  )
  .get(created.publicId);

if (!row || row.status !== "NEW" || Number(row.flag) !== 0) {
  console.error(JSON.stringify({ error: "seed_invalid", row }));
  process.exit(1);
}

process.stdout.write(created.publicId);
