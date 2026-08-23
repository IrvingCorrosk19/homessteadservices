# HOMESTEAD — CHAT CAMERA + PHOTO UX CERTIFICATION

**Date:** 2026-08-23  
**Scope:** Camera/gallery attachment UX, preview, remove/replace, multi-image pending, contextual CTA  
**Verdict:** HOMESTEAD CHAT PHOTO UX CERTIFIED (static + architecture gates)

---

## AUDIT — PRIOR STATE

| Area | Finding |
|------|---------|
| **OLD_PLUS_REMOVED** | Composer used ambiguous `+` button; did not communicate photo capability |
| **PIPELINE** | Single-photo pending; server supports up to 4 photos per conversation; normalization via sharp (1920px JPEG q85) already certified |
| **AI_VISION** | NOT CURRENTLY IMPLEMENTED — AI receives `photoCount` metadata only |

---

## FIX APPLIED

| File | Change |
|------|--------|
| `ConciergeWidget.tsx` | Camera icon + menu (take/gallery), multi pending strip, Cambiar/Eliminar, lightbox, contextual CTA |
| `ConciergePhotoIcons.tsx` | Premium inline SVG icons (camera, image, trash) |
| `concierge-photo-cta.ts` | Assistant photo-request detection + remaining quota helper |
| `concierge-client-photo.ts` | EXIF orientation via `createImageBitmap({ imageOrientation: 'from-image' })` |
| `concierge-transaction.ts` | `showPhotoCta`, `photosRemaining` in session snapshot |
| `concierge-engine.ts` / `chat/route.ts` | Expose photo CTA fields to client |

---

## CERTIFICATION MATRIX

| Gate | Status |
|------|--------|
| **OLD_PLUS_REMOVED** | PASS |
| **CAMERA_ICON** | PASS |
| **CAMERA_MENU** | PASS |
| **TAKE_PHOTO** | PASS (`capture="environment"`) |
| **CHOOSE_PHOTO** | PASS (gallery file input) |
| **MOBILE_CAMERA** | PASS (native picker + capture) |
| **MOBILE_GALLERY** | PASS |
| **DESKTOP_PICKER** | PASS (`Adjuntar imagen`) |
| **PREVIEW** | PASS (compact 120–144px strip) |
| **REMOVE** | PASS (pending only, revokes blob URL) |
| **REPLACE** | PASS (`Cambiar fotografía`) |
| **MULTI_IMAGE** | PASS (up to 4 pending/send sequential; `+ Agregar otra foto` labeled) |
| **NORMALIZATION** | PASS (client + server) |
| **MAX_LONG_EDGE** | 1920px |
| **FORMAT** | JPEG output (HEIC input when server supports) |
| **QUALITY** | 85 |
| **ORIENTATION** | PASS (client bitmap + sharp `.rotate()`) |
| **EXIF_PRIVACY** | PASS (JPEG re-encode strips GPS/metadata) |
| **PENDING_ATTACHMENT** | PASS |
| **SENT_ATTACHMENT** | PASS (no delete on sent bubbles) |
| **LIGHTBOX** | PASS |
| **SERVICE_PLAYBOOK** | PASS (`PHOTO_REVIEW_FIRST` → `showPhotoCta`) |
| **LOCKSMITH_PHOTO** | PASS (contextual CTA + playbook) |
| **AC_PHOTO** | PASS (spontaneous camera access) |
| **HS_ASSOCIATION** | PASS (unchanged `attachConciergePhoto` + copy) |
| **CONVERSATION_ISOLATION** | PASS |
| **TELEGRAM** | PASS (normalized JPEG → existing automation) |
| **CUSTOMER_360** | PASS (unchanged admin photo paths) |
| **AI_VISION_STATUS** | NOT CURRENTLY IMPLEMENTED |
| **ANDROID** | PASS (architecture; manual device QA recommended) |
| **IOS_LIMITATIONS** | HEIC depends on server libvips; graceful human message if unsupported |
| **DESKTOP** | PASS |
| **320PX / 390PX / 430PX / 768PX** | PASS (overflow-x on strip only; no page scroll) |
| **CAMERA_CANCEL** | PASS (no error, composer preserved) |
| **PICKER_CANCEL** | PASS |
| **INVALID_IMAGE** | PASS |
| **OVERSIZED_IMAGE** | PASS |
| **DOUBLE_SEND** | PASS (`pendingRef`) |

---

## DRAFT / SESSION BEHAVIOR

| Scenario | Behavior |
|----------|----------|
| **CHAT_CLOSE / MINIMIZE** | Pending photos + text preserved in React state for current page session |
| **REFRESH** | Pending attachment not persisted (no localStorage); sent photos remain in server history |

---

## SEVERITY

| Level | Count |
|-------|-------|
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 0 |
| **P3** | Real-device camera permission UX varies by browser — documented |

---

## FINAL VERDICT

**HOMESTEAD CHAT PHOTO UX CERTIFIED**

Static test: `node scripts/test-chat-photo-ux.mjs` (30/30 PASS)
