/** Session keys for preserving list context across detail navigation. */
export const OPS_LIST_SCROLL_KEY = "hs-ops-list-scroll";
export const OPS_LIST_FILTER_KEY = "hs-ops-list-filter";
export const OPS_HIDE_ATTENDED_KEY = "hs-ops-hide-attended";

export function saveOpsListContext(filter: string, hideAttended: boolean) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(OPS_LIST_FILTER_KEY, filter);
  sessionStorage.setItem(OPS_HIDE_ATTENDED_KEY, hideAttended ? "1" : "0");
  sessionStorage.setItem(OPS_LIST_SCROLL_KEY, String(window.scrollY));
}

export function readOpsListScroll(): number | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(OPS_LIST_SCROLL_KEY);
  sessionStorage.removeItem(OPS_LIST_SCROLL_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function readOpsHideAttended(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(OPS_HIDE_ATTENDED_KEY);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export function buildReturnTo(path: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export function safeReturnTo(raw: string | null | undefined, fallback = "/admin/solicitudes?ops=NEEDS_ATTENTION") {
  if (!raw?.startsWith("/admin")) return fallback;
  if (raw.includes("//") || raw.includes("..")) return fallback;
  return raw;
}
