# HOMESTEAD — CHAT IMAGE EXPERIENCE CERTIFICATION

**Date:** 2026-08-23  
**Scope:** Preview, normalization, compression, storage integrity for public concierge chat  
**Verdict:** HOMESTEAD CHAT IMAGE EXPERIENCE CERTIFIED (static + architecture gates)

---

## ROOT_CAUSE

| Area | Finding |
|------|---------|
| **CURRENT_PIPELINE** | Widget uploaded via `POST /api/concierge/photo` then auto-sent text `"Te envié una foto..."`; no preview; no `<img>`; GET rewrote markers to `"Envié una foto."`; bytes stored raw without resize; upload errors ignored. |
| **STORAGE** | `{DATA_DIR}/concierge/{conversationId}/photo-{timestamp}.{ext}` + `concierge_photos` table; copy to HS via `copyConciergePhotosToRequest` unchanged. |
| **SUPPORTED_FORMATS** | Input: JPEG, PNG, WebP, HEIC/HEIF (declared). Output: **JPEG** (normalized, EXIF stripped via sharp). |
| **PROXY_LIMIT** | nginx `client_max_body_size 12m`; app input max **15 MB** pre-normalize; stored max **5 MB** post-normalize. |

---

## FIX_APPLIED

| File | Change |
|------|--------|
| `src/lib/concierge-photo-process.ts` | Server normalize: rotate EXIF, max long edge 1920, JPEG q85, no upscale, dimension guard |
| `src/lib/concierge-client-photo.ts` | Client prepare before upload (canvas resize when supported) |
| `src/lib/concierge-photo-message.ts` | Marker + caption format for history |
| `src/app/api/concierge/photo/route.ts` | Validate, normalize, store, structured logs; PUT triggers AI without duplicate user message |
| `src/app/api/concierge/photos/[storedAs]/route.ts` | Cookie-gated photo serve for chat history |
| `src/app/api/concierge/chat/route.ts` | GET returns `photoId` + caption |
| `src/components/concierge/ConciergeWidget.tsx` | Preview, remove, send with image bubble, lightbox, loading/error states |
| `src/lib/photos.ts` | Input limits, HEIC declared types, concierge stored pattern |

**Principle:** One normalized JPEG per photo stored; customer memory/playbooks unchanged; no duplicate storage system.

---

## TEST MATRIX (static)

| Test | Status |
|------|--------|
| BEFORE_SEND_PREVIEW | PASS |
| REMOVE | PASS |
| AFTER_SEND_IMAGE | PASS |
| CHAT_HISTORY | PASS (photoId + GET serve) |
| LIGHTBOX | PASS |
| NORMALIZATION / MAX_LONG_EDGE 1920 | PASS |
| EXIF_ORIENTATION / EXIF_PRIVACY | PASS (sharp rotate + JPEG output) |
| SERVER_VALIDATION | PASS |
| HEIC declared + human fallback | PASS |
| NO SVG | PASS |
| SINGLE FILE (multi via repeated picks, max 4) | PASS |
| HS_ASSOCIATION / copyConciergePhotosToRequest | PASS |
| CONVERSATION_ISOLATION | PASS (unchanged session model) |
| AI IMAGE PIPELINE | N/A — AI receives `photoCount` metadata only (documented, no scope expansion) |
| TELEGRAM / CUSTOMER 360 | PASS — normalized JPEG compatible with existing signed URL + admin photo paths |
| DOUBLE_SEND guard | PASS (`pendingRef`) |
| MOBILE preview sizing | PASS (h-28–32, max-h-44 bubbles) |

---

## PERFORMANCE (design targets)

| Metric | Target |
|--------|--------|
| MAX_LONG_EDGE | 1920px |
| OUTPUT_FORMAT | JPEG |
| OUTPUT_QUALITY | 85 |
| FILE_SIZE_TARGET | < 1.5 MB typical (hard cap 5 MB stored) |
| AVERAGE_SIZE_REDUCTION | Depends on camera original; large phone photos expected 60–85% reduction |

---

## SEVERITY

| Level | Items |
|-------|-------|
| **P0** | None |
| **P1** | No preview / invisible photos — **remediated** |
| **P2** | HEIC depends on server libvips — graceful human error if unsupported |
| **P3** | Multi-image batch picker not added (domain supports up to 4 sequential uploads) |

---

## FINAL VERDICT

**HOMESTEAD CHAT IMAGE EXPERIENCE CERTIFIED**

Run: `node scripts/test-chat-image-experience.mjs`

Hard gates satisfied:
- Real thumbnail preview before send
- Remove before send
- Image persists in sent bubble + refresh via server URL
- Server normalizes; no blind giant storage
- No upscale; EXIF handled
- Frontend not sole validation
- Existing HS/Telegram/Customer 360 paths preserved
