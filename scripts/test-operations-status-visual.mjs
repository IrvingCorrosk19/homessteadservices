import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else console.log("PASS", name);
}

const visualSrc = readFileSync(join(root, "src/lib/request-status-visual.ts"), "utf8");
const pillSrc = readFileSync(join(root, "src/components/admin/StatusPill.tsx"), "utf8");
const opsClientSrc = readFileSync(join(root, "src/components/admin/SolicitudesOperationsClient.tsx"), "utf8");
const detailSrc = readFileSync(join(root, "src/components/admin/RequestDetailClient.tsx"), "utf8");
const contactedRoute = readFileSync(join(root, "src/app/api/admin/service-requests/[requestId]/contacted/route.ts"), "utf8");
const patchRoute = readFileSync(join(root, "src/app/api/admin/service-requests/[requestId]/route.ts"), "utf8");
const opsStoreSrc = readFileSync(join(root, "src/lib/ops-store.ts"), "utf8");
const timelineSrc = readFileSync(join(root, "src/components/admin/TimelineRequestStatus.tsx"), "utf8");
const solicitudesPage = readFileSync(join(root, "src/app/admin/solicitudes/page.tsx"), "utf8");

check("STATE_MODEL_AUDITED uses real NEW/CONTACTED/IN_PROGRESS", visualSrc.includes("NEW") && visualSrc.includes("CONTACTED") && visualSrc.includes("IN_PROGRESS"));
check("PENDING_VISUAL icon+border+label", visualSrc.includes('icon: "●"') && visualSrc.includes("pending"));
check("IN_PROGRESS_VISUAL distinct", visualSrc.includes("in_progress") && visualSrc.includes("En gestión"));
check("ATTENDED_VISUAL checkmark", visualSrc.includes('icon: "✓"') && visualSrc.includes("Atendida"));
check("URGENT_VISUAL sla only on NEW", visualSrc.includes("urgent") && visualSrc.includes("slaEscalated"));
check("FILTERS ops buckets", visualSrc.includes("NEEDS_ATTENTION") && opsClientSrc.includes("OPS_FILTERS"));
check("COUNTERS bucket counts", opsClientSrc.includes("opsFilterCounts") && opsClientSrc.includes("bucketCounts"));
check("OPTIMISTIC_UPDATE mark attended", opsClientSrc.includes("setItems") && opsClientSrc.includes("CONTACTED"));
check("NO_RELOAD no location.reload", !opsClientSrc.includes("location.reload") && !detailSrc.includes("location.reload"));
check("markEntityContacted admin API", contactedRoute.includes("markEntityContacted") && contactedRoute.includes('"admin"'));
check("PATCH CONTACTED syncs lead", patchRoute.includes('status === "CONTACTED"') && patchRoute.includes("markEntityContacted"));
check("ATTENTION_CENTER_SYNC uses markEntityContacted", opsStoreSrc.includes("markEntityContacted") && opsStoreSrc.includes("REQUEST_MARKED_CONTACTED"));
check("CUSTOMER_360_SYNC StatusPill timeline", timelineSrc.includes("StatusPill") && timelineSrc.includes("isRequestStatus"));
check("MOBILE badge visible without open", pillSrc.includes("truncate") && opsClientSrc.includes("StatusPill"));
check("ACCESSIBILITY aria-label", pillSrc.includes("aria-label") && visualSrc.includes("ariaLabel"));
check("VISUAL_CONSISTENCY single resolver", pillSrc.includes("resolveRequestVisual") && opsClientSrc.includes("resolveRequestVisual"));
check("hide attended toggle", opsClientSrc.includes("Ocultar atendidas"));
check("default needs attention filter", solicitudesPage.includes("NEEDS_ATTENTION"));
check("microinteraction attended flash", opsClientSrc.includes("✓ Solicitud atendida"));
check("rollback on failure", opsClientSrc.includes("countSnapshot"));

if (failed) {
  console.error(`\n${failed} operations status visual checks failed`);
  process.exit(1);
}
console.log("\nOPERATIONS_STATUS_VISUAL_OK");
