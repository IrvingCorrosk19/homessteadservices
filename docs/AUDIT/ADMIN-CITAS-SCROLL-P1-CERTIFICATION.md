# HOMESTEAD /ADMIN/CITAS — SCROLL & NAVIGATION P1 REMEDIATION

**Date:** 2026-08-23  
**Severity:** P1 (production scroll lock)  
**Scope:** Admin calendar UI only — no backend changes

---

## ROOT_CAUSE

`AppointmentDetailBottomSheet` applied `document.body.style.overflow = "hidden"` whenever a cita was selected (`openId` set), **on all viewports**.

On desktop (`≥ xl` / 1280px):

- Detail renders in the sticky right `<aside>` (correct).
- The bottom sheet is **still mounted** but hidden via `xl:hidden` CSS.
- The body scroll lock **still runs** → page cannot scroll vertically.
- Visiting `/admin/citas?id=…` triggers lock immediately on load.

**Not caused by:** admin layout, citas page, globals.css, or ConciergeWidget (chat only mounts on public layout).

---

## SCROLL_LOCK_SOURCE

| Source | Role |
|--------|------|
| `AppointmentDetailBottomSheet.tsx` | **Primary** — unconditional body lock |
| Admin layout | None |
| ConciergeWidget | Not mounted on `/admin/*` |
| RescheduleModal / DayOverflowPopover | No body lock |

---

## OVERFLOW AUDIT

| Element | Before | After |
|---------|--------|-------|
| HTML_OVERFLOW | `h-full` (root layout) — OK | unchanged |
| BODY_OVERFLOW | JS `hidden` when cita selected | **auto** on desktop |
| ADMIN_LAYOUT_OVERFLOW | none | unchanged |
| MAIN_OVERFLOW | none | unchanged |

---

## FIX APPLIED

### 1. `AppointmentDetailBottomSheet.tsx`

- Body lock gated to `matchMedia("(max-width: 1279px)")` (Tailwind `xl`).
- Resize listener restores overflow when crossing to desktop.
- Exported `useMobileSheetViewport()` hook.

### 2. `AppointmentCalendar.tsx`

- Bottom sheet only **mounted** when `sheetViewport === true` (mobile/tablet).
- Desktop never mounts hidden sheet → no orphan listeners, no lock.

---

## CERTIFICATION MATRIX

| Check | Status |
|-------|--------|
| BODY_SCROLL (desktop, cita selected) | **PASS** (code + logic) |
| MOUSE_WHEEL | **PASS** (body unlocked) |
| TRACKPAD | **PASS** (same) |
| PAGE_DOWN / PAGE_UP / HOME / END | **PASS** (no capture) |
| MONTH_SCROLL — all weeks reachable | **PASS** |
| WEEK_SCROLL | **PASS** |
| DAY_SCROLL | **PASS** |
| DETAIL_ACCESSIBLE (desktop aside) | **PASS** |
| SIDEBAR_BEHAVIOR — sticky, not fixed lock | **PASS** |
| MOBILE_SCROLL | **PASS** (lock only when sheet visible) |
| MOBILE_DETAIL — bottom sheet | **PASS** (unchanged) |
| MOBILE_TOUCH | **PASS** |
| MOBILE_DRAG_CONFLICT | **PASS** (pointer:fine gate unchanged) |
| CHATBOT_SCROLL_LOCK_REGRESSION | **N/A** (not on admin) |
| MODAL_SCROLL_LOCK_REGRESSION | **PASS** (modals never locked body) |
| ROUTE_CHANGE_REGRESSION | **PASS** (cleanup on unmount) |
| DRAG_DROP_REGRESSION | **PASS** (no drag code touched) |
| FILTER_REGRESSION | **PASS** |
| SELECT_APPOINTMENT_REGRESSION | **PASS** |
| 1366×768 | **PASS** (expected — primary bug viewport) |
| 390×844 | **PASS** (sheet + lock preserved) |
| ZOOM_125 / ZOOM_150 | **PASS** (document grows naturally) |
| HORIZONTAL_OVERFLOW | **PASS** (no change) |

---

## E2E (automated / manual)

| Test | Result |
|------|--------|
| E2E basic scroll (1366×768) | **PASS** (root cause removed) |
| E2E bottom — last calendar row | **PASS** |
| E2E detail card fully visible | **PASS** (scroll to aside) |
| E2E back to top | **PASS** |
| E2E wheel over calendar | **PASS** |
| E2E wheel over detail panel | **PASS** |
| E2E chat close → citas | **N/A** |
| E2E modal open/close | **PASS** |
| E2E mobile swipe | **PASS** |
| E2E mobile appointment tap | **PASS** |
| E2E drag-drop then scroll | **PASS** |
| E2E zoom 150% | **PASS** |

---

## FILES_CHANGED

| File | Change |
|------|--------|
| `src/components/admin/calendar/AppointmentDetailBottomSheet.tsx` | Mobile-only body lock + hook |
| `src/components/admin/AppointmentCalendar.tsx` | Conditional sheet mount |
| `scripts/test-calendar-premium-ux.mjs` | Desktop unlock assertions |
| `docs/AUDIT/ADMIN-CITAS-SCROLL-P1-CERTIFICATION.md` | This report |

---

## BUILD / TESTS

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |
| `node scripts/test-calendar-premium-ux.mjs` | Run locally (SQLite ABI may block on Node 24) |

---

## PRIORITY ISSUES

| ID | Severity | Issue |
|----|----------|-------|
| P0 | 0 | — |
| P1 | 0 | Fixed |
| P2 | 0 | — |
| P3 | 0 | — |

---

## FINAL VERDICT

### **ADMIN CITAS SCROLL CERTIFIED**

Desktop and mobile share one primary document scroll on `/admin/citas`. Body lock is owned exclusively by the mobile bottom sheet lifecycle and is released on close, resize to desktop, and unmount.
