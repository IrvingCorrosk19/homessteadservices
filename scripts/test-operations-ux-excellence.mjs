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

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const dashboard = read("src/app/admin/page.tsx");
const topBar = read("src/components/admin/AdminTopBar.tsx");
const mobileNav = read("src/components/admin/AdminMobileNav.tsx");
const search = read("src/components/admin/AdminGlobalSearch.tsx");
const searchApi = read("src/app/api/admin/search/route.ts");
const attention = read("src/components/admin/NeedsAttentionBlock.tsx");
const opsClient = read("src/components/admin/SolicitudesOperationsClient.tsx");
const opsNav = read("src/lib/ops-navigation-state.ts");
const detail = read("src/components/admin/RequestDetailClient.tsx");
const customerOps = read("src/components/admin/Customer360OpsSummary.tsx");
const calendar = read("src/components/admin/AppointmentCalendar.tsx");
const copilot = read("src/app/admin/copilot/page.tsx");

check("NEEDS_ATTENTION dashboard first", dashboard.indexOf("NeedsAttentionBlock") < dashboard.indexOf("Embudo"));
check("MOBILE_NAV bottom fixed", mobileNav.includes("fixed inset-x-0 bottom-0") && mobileNav.includes("md:hidden"));
check("GLOBAL_SEARCH api", searchApi.includes("adminGlobalSearch") && search.includes("/api/admin/search"));
check("GLOBAL_SEARCH ctrl k", search.includes('event.key.toLowerCase() === "k"'));
check("FILTER_MEMORY url ops", opsClient.includes("params.set(\"ops\"") && opsClient.includes("applyFilter"));
check("SCROLL_MEMORY session", opsClient.includes("saveOpsListContext") && opsClient.includes("readOpsListScroll"));
check("CONTEXT returnTo detail", detail.includes("returnTo") && detail.includes("safeReturnTo"));
check("CONTEXT openDetail returnTo", opsClient.includes("returnTo="));
check("CUSTOMER_360 ops summary", customerOps.includes("Resumen operativo") && customerOps.includes("Qué necesita"));
check("CALENDAR url memory", calendar.includes("params.set(\"view\"") && calendar.includes("params.set(\"date\""));
check("NO_RELOAD ops list", !opsClient.includes("location.reload") && !detail.includes("location.reload"));
check("COPILOT nav links", copilot.includes("Ver pendientes") && copilot.includes("NeedsAttentionBlock"));
check("ATTENTION visual badges", attention.includes("resolveAttentionVisual") && attention.includes("aria-hidden"));
check("ADMIN layout mobile padding", read("src/app/admin/layout.tsx").includes("pb-24"));
check("REQUEST sticky mobile actions", detail.includes("fixed inset-x-0 bottom-[calc(4.5rem"));
check("EMPTY human messages", opsClient.includes("No tienes solicitudes pendientes"));

if (failed) {
  console.error(`\n${failed} operations UX excellence checks failed`);
  process.exit(1);
}
console.log("\nOPERATIONS_UX_EXCELLENCE_OK");
