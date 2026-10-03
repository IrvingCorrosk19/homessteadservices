# 03 — Panel Telegram y funciones

**Bot:** `@HomesteadServicesNotifyBot` (`t.me/HomesteadServicesNotifyBot`). Un solo bot.  
**Inbound:** webhook → n8n `homestead-content-studio` → `POST /api/internal/content/telegram-update` → `handleTelegramUpdate` (`src/lib/content-handler.ts`).  
**Observación código:** 2026-10-02.  
**Observación ejecución:** inbound **BLOQUEADO** (SSL webhook, 0 updates desde 2026-09-24). Lo que sigue es **verificado en código** salvo donde se indique dato vivo.

Router único. No hay segundo bot ni `9TG_GATEWAY_V1`.

---

## 1. Gates globales

| Gate | Código | Efecto |
| --- | --- | --- |
| Chat privado | `content-handler.ts` ~157, 635 | Grupos: `accessDeniedText("group")` |
| Operador | `gateOperator` `telegram-operator-flow.ts` | Registrado, no `PENDING`, `is_active` |
| Dedup | `seenTelegramUpdate` → `content_telegram_updates` | Reintentos de Telegram no re-ejecutan |
| Content Studio flag | `CONTENT_STUDIO_ENABLED` | Foto/campaña/comandos de contenido |
| RBAC | `telegram-operators.ts` `ROLE_PERMISSIONS` | OWNER/ADMIN/SALES/CONTENT/TECHNICIAN |

Vivo: 2 operadores (1 OWNER, 1 ADMIN), ambos activos. **VERIFICADO** `COUNT` por rol. Sin PII.

`/start` crea solicitud `PENDING` si el user no existe (`telegram-operator-flow.ts`).

---

## 2. Comandos solicitados

Todos los de la lista están **FOUND en código**. Ejecución actual: **BLOQUEADA** por webhook.

| Comando | Qué ve / puede | Handler | API / datos | Permiso | Idempotencia | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| `/homestead` | Home Command Center (conteos) | `content-handler.ts:671` → `ops-telegram.sendCommandCenter` | SQLite ops (HS, leads, agenda) | operador activo | solo lectura | Código **VERIFICADO**. Doc `HOMESTEAD-TELEGRAM-COMMAND-CENTER.md` |
| `/hoy` | Agenda hoy Panama | `:804` → `agendaView` | `revenue_appointments` | activo | RO | Código. **No** usa `formatHoy` de revenue (ese es API interna) |
| `/leads` `/calientes` | Rescue / calientes | `:810` | `revenue_leads` / SLA | activo | RO | Código |
| `/agenda` | Igual agenda | `:822` | citas | activo | RO | Código |
| `/trabajos` | Lista HJ- | `:828` `jobsView` | `revenue_jobs` (0 filas vivas) | activo | RO | Código; datos vacíos **VERIFICADO** |
| `/publicar` | Inicia job HC- `RECEIVING` | `:1182` | `content_jobs` | activo + studio | bloquea si `activeJobForChat` | Código |
| `/pendientes` | Jobs por aprobar | `:877` | `listJobsByStatus` | studio | RO | Código |
| `/programadas` | SCHEDULED | `:887` | idem | studio | RO | Código |
| `/publicadas` | PUBLISHED | `:903` | idem | studio | RO | Código |
| `/proxima` | Siguiente slot | `:913` | settings + jobs | studio | RO | Código |
| `/estado` | Pause, dry-run, cadencia | `:924` | `content_settings` | studio | RO | Código |
| `/pausa` | Pausa global + limpia `live_once` | `:941` `setContentPaused(true)` | settings | studio | reaplicar benigno | Código |
| `/reanudar` | Quita pausa | `:949` | settings | studio | benigno | Código |
| `/seguimientos` | Follow-ups | `:955` `revenue-telegram` | `revenue_followups` (6) | studio | RO | Código |
| `/cotizaciones` | Quotes + `backfillFromServiceRequests` | `:960` | puede **escribir** sync | studio | no del todo RO | Código |
| `/clientes` | Prompt de búsqueda | `:965` | — | `customers.read` | UI | Código |
| `/cliente …` | Ficha | `:976` | customers | `customers.read` | RO | Código |
| `/reseñas` `/resenas` | Snapshot reseñas | `:988` | `revenue_reviews` (0) | studio | RO | Placeholder de datos |
| `/mantenimientos` | Snapshot | `:996` | `revenue_maintenance` (0) | studio | RO | Placeholder de datos |
| `/live` / `/live HC-…` | Confirma 1 publicación live | `:1215` | no publica hasta `liveyes` | `content.approve` | confirmación | Código |
| `/campana` `/campaña` | Crea/reusa CM- | `campaign-telegram.ts:224` | `campaigns` | `content.read`; aprobar exige `content.approve` | reusa campaña abierta | Código. Vivo: CM-002 `SCHEDULED` |
| `/piezas` | Bundle CP- | `:288` | piezas | read | RO | Código |
| `/calendario` | Calendario campaña | `:277` | piezas | read | RO | Código |
| `/resultados` | Funnel | `:331` | clicks/events | read | RO | Código |
| `/aprobar_campana` | Aprueba CM | `:295` | `approveCampaign` → schedule/sim | approve | claims/stale | Código |
| `/pausar_campana` | Pausa | `:311` | `pauseCampaign` | read | benigno | Código |
| `/cancelar_campana` | Cancela (histórico) | `:321` | `cancelCampaign` | read | — | Código |
| `/prioridad HC-` | `businessPriority=1` | `:1135` | job | studio | overwrite | Código |
| `/lead` | Inserta `marketing_leads` | `:1114` | **INSERT cada vez** | studio | **no idempotente** | Código |
| `/copilot` `/copiloto` | Sesión copilot | `:676` | `copilot_sessions` | activo | reabre | Código |

`isOpsCommand` solo trata `/homestead /hoy /leads /calientes /agenda /trabajos` para mensajes de denegación. El resto sigue el router.

Otros (no pedidos, implementados): `/ventas`, `/recomendar`, `/porque`, `/aprendizaje`, `/rendimiento`, `/horarios`, `/servicios`, `/mejores`, `/enfoque`, NL de campaña.

---

## 3. Callbacks

| Prefijo | Módulo | Mutaciones destacadas | Stale / idempotencia |
| --- | --- | --- | --- |
| `cc:` | `ops-telegram.ts` | contactado, snooze, dismiss, start/complete job, fotos, operadores | `already` en contact/complete/dismiss |
| `rv:` | `revenue-telegram.ts` | visita, quote, later, stop… | `markLeadHumanAction` primero |
| `cm:` `cp:` | `campaign-telegram.ts` | approve/pause/cancel campaña; approve/reimage pieza | reimage sube versión |
| `cs:` | `content-handler.ts` | process, approve, reject, slot, now, live, regen… | `:vN` + `assertCallbackVersion` |
| `cs:bt:` | `content-photo-batch.ts` | aprobar lote, nowpick, carrusel-aviso | skip PUBLISHED; stale por versión |
| `mi:` | marketing shadow | approve/skip/nopost | no publica |
| `auto:ack:` | autonomous tokens | consume token | un solo uso |

Permiso: approve/reject/slot/now/live/`cs:bt:` → `content.approve`. Resto contenido → `content.read`. `rv:` → `leads.manage` o `appointments.manage`.

Botones URL: `https://homestead.lat/admin/…`, `https://wa.me/…`. `tel:` no se usa (rompió mensajes, doc Command Center).

---

## 4. Fotos, álbumes, video, carrusel

| Tema | Comportamiento | Estado |
| --- | --- | --- |
| Foto suelta | Flush inmediato, 1 HC- | Código `content-handler.ts` ~1335 |
| Álbum `media_group_id` | `album:{chatId}:{mediaGroupId}`, espera 1800 ms, 1 HC por foto, lote `HB-` | Código `content-photo-batch.ts` |
| Dedup | `telegram_file_id`, sha256, `update_id` | Código |
| Aprobar lote | `cs:bt:{HB}:ok` → `approvePhotoBatch` → slots escalonados `SCHEDULED` | Código L485–534 |
| Publicar una ahora | `nowpick` / `cs:…:now` / `/live` | Código. `now` no usa `live_once`; con dry-run global false **sí puede** ir a Graph |
| Carrusel | Botón sugiere; texto `CAROUSEL_UNSUPPORTED`; no cambia la elección | Código |
| Video / reels | — | **NO ENCONTRADO** en handler (solo photo/document imagen) |
| Vivo | 8 lotes HB-001…008; 20 intake; 157 assets | **VERIFICADO** conteos |

---

## 5. Qué es funcional / parcial / histórico

| Función | Clasificación | Nota |
| --- | --- | --- |
| Command Center `/homestead` y `cc:` | Código completo; inbound hoy **BLOQUEADO** | Datos de solicitudes/citas sí existen (pocos) |
| Content Studio foto→copy→aprobar→slot | Código + datos hasta 24-sep | Último update 24-sep |
| Campañas | Código + CM-002 `SCHEDULED`, piezas 025–028 en `NEEDS_REVIEW` post-fallo Meta | |
| `/reseñas` `/mantenimientos` `/cotizaciones` / trabajos | Implementado, **datos 0 o casi 0** | No inventar tablas por el botón |
| Wave B “autorización solo env allowlist” | **HISTÓRICO** | Hoy SQLite `telegram_operators` + seed de env |

---

## 6. Relación con la app nueva

Todo lo que el operador hace en Telegram ya es una función TypeScript. La app nueva debe **llamar esas funciones** (o un facade HTTP de sesión), no reimplementar callbacks `cs:`/`cc:`.

Prioridad de pantallas = lo que hoy **solo** existe en Telegram: cola HC-, lotes HB-, campañas CM-/CP-, errores de `content_publications`.
