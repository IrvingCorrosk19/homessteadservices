# Renovación AI Concierge + n8n — entrega Fase 1 (aislada)

**Branch:** `feat/concierge-n8n-renewal`  
**Marker:** `v3.3-n8n`  
**Engine under test:** `AI_CONCIERGE_ENGINE=n8n` + `AI_CONCIERGE_N8N_MODE=local`  
**Evidence:** this folder (`transcript.json`, `results.txt`)  
**Production deploy:** NOT executed (per scope)

---

## 1. Diagnóstico (causas demostradas)

| Incidencia | Estado | Causa / evidencia |
|------------|--------|-------------------|
| Recopila datos sin crear HS | Parcialmente mitigado | Firewall speech-act + auth fail-closed; síntomas ya ACTIONABLE; motor n8n llama `upsert_request` al detectar intención / hechos listos |
| “Reviso y confirmo” sin cerrar | Parcialmente mitigado | Copy en `slot-state` ya no promete confirmación; book solo tras `create_appointment` OK; mismo turno en motor n8n |
| Pierde contexto al corregir / nueva necesidad | Parcialmente mitigado | Phone/unit biz-sep previo; `reconcileTransactionState` ya no borra `activeLeadId` en new-need (park en facts) |
| Cancelaciones incompletas | Mitigado en motor n8n | Confirmación ligada a `pendingConfirmation` + `cancelServiceRequest` real |
| Teléfono cliente = Homestead | Fixed (prev) | `business-contact.ts` + ops early path; e2e PASS |
| Push nueva solicitud no llega | Pipeline OK aislado | Outbox `control.push.new_request` DELIVERED en simulación; físico A06 = NO PROBADO aquí |
| Pantallas rojas push/logout | Mitigaciones en árbol Flutter | Ver `push_service.beginLogout`; re-verificar en dispositivo — NO PROBADO esta entrega |

Flags efectivos: `DRY_RUN` default true (no Telegram/n8n notify cliente); `CREATE_LEADS` on; push enqueue no depende de dry-run para INSERT HS.

n8n existente: Telegram solicitud + Control push. **No había workflow de chat** — se añade export `n8n/homestead-n8n-concierge-turn.json`.

---

## 2. Arquitectura implementada

```
Widget → POST /api/concierge/chat
  → pin engine (legacy|n8n) por conversación
  → n8n: createTurn → coordinator (local|remote)
       → business-tools (autoriza/ejecuta)
       → SQLite HS/citas/outbox
       → reply + requestCard
  → legacy: conciergeTurn (sin cambios de contrato UI)
```

- **IA propone / backend autoriza** vía `business-tools.ts`.
- **n8n no escribe SQL** de negocio; solo HTTP a `/api/internal/concierge/*` (remoto) o coordinator local.
- **Turnos cortos** (`concierge_turns`); poll `GET /api/concierge/turn/[turnId]`.
- **Sin lock SQLite** durante red/IA.
- **SQLite se mantiene**; PostgreSQL = migración futura documentada abajo.

### Decisiones

1. Selector `AI_CONCIERGE_ENGINE=legacy|n8n` + pin por conversación.
2. Modo `local` para aislamiento sin tocar n8n productivo del VPS.
3. Reutilizar `ensureActiveServiceRequest`, `executeConciergeTool`, `cancelServiceRequest`, `control-push`.
4. Un motor por conversación; no switch silencioso mid-op.

### PostgreSQL (futuro, no ejecutado)

Migrar `service_requests`, `concierge_*`, appointments y outbox a Postgres con el mismo esquema lógico; n8n sigue llamando APIs internas. No mezclar tablas de n8n con tablas de negocio.

---

## 3. Contratos internos

Header: `x-homestead-internal-secret` (= `CONCIERGE_INTERNAL_SECRET`)

| Action | Efecto |
|--------|--------|
| get_context | Snapshot sin PII cruda de negocio |
| interpret | Intent estructurado + packed extraction |
| save_facts | Nombre/tel/zona/servicio + sync HS |
| upsert_request | Crear/actualizar HS (auth + idempotencia) |
| check_availability | Slots (no garantiza reserva) |
| book_appointment | Revalida slot + `customerConfirmed` |
| reschedule / cancel | Con confirmación |
| business_contact | Solo config aprobada |
| human_handoff | Flag revisión humana |
| reconcile_request | Recuperar tras respuesta perdida |

---

## 4. Workflows n8n

- `n8n/homestead-n8n-concierge-turn.json` — entrada + get_context + interpret + upsert (extensible).
- Existentes sin tocar: `homestead-n8n-telegram-workflow.json`, `homestead-n8n-control-push.json`.

Vars (ejemplo, sin secretos): `CONCIERGE_INTERNAL_SECRET`, `HOMESTEAD_INTERNAL_BASE`.

---

## 5. Config de ejemplo (sin secretos)

```env
AI_CONCIERGE_ENABLED=true
AI_CONCIERGE_ENGINE=n8n
AI_CONCIERGE_N8N_MODE=local
AI_CONCIERGE_DRY_RUN=true
AI_CONCIERGE_CREATE_LEADS=true
CONCIERGE_INTERNAL_SECRET=replace-me
# remote only:
# AI_CONCIERGE_N8N_MODE=remote
# N8N_CONCIERGE_TURN_WEBHOOK_URL=https://n8n-isolated.example/webhook/homestead-concierge-turn
NEXT_PUBLIC_PHONE=+507 6000-1111
NEXT_PUBLIC_OFFICIAL_WHATSAPP=true
DATA_DIR=./data/control-test
HOMESTEAD_CONTROL_ISOLATED=true
```

---

## 6. Prueba plomería (simulacion)

Script: `scripts/test-concierge-n8n-plumbing-e2e.mjs`  
Resultado: **ALL PASS [simulacion]**

Recorrido: fuga → nombre+tel → corrección tel → zona → WhatsApp Homestead → retoma → HS único → push outbox → horarios → reserva → cancel con confirmación.

---

## 7. Matriz

| Caso | Resultado |
|------|-----------|
| Plomería e2e aislado (API/coordinator) | **PASS** [simulacion] |
| Contacto comercial vs cliente | **PASS** |
| Contacto comercial ausente | **PASS** |
| Push outbox new_request | **PASS** [simulacion] |
| Reserva cita aislada | **PASS** [simulacion] |
| Cancel con confirmación | **PASS** [simulacion] |
| UI widget real en browser | **NO PROBADO** |
| n8n remoto importado en VPS aislado | **BLOCKED** — no se tocó n8n productivo; falta instancia aislada |
| Push físico A06 shade/tap | **NO PROBADO** |
| Pantalla roja logout/tap | **NO PROBADO** (código mitigado previo) |
| Dos pestañas / race slots | **NO PROBADO** |
| Reprogramar | **NO PROBADO** (tool expuesto; no en recorrido plomería) |
| APK | **NO MODIFICADA** |

---

## 8. Guía entorno aislado

```bash
# Desde repo
set AI_CONCIERGE_ENGINE=n8n
set AI_CONCIERGE_N8N_MODE=local
npx tsx scripts/test-concierge-n8n-plumbing-e2e.mjs
# Usa data/control-test (CONTROL_DEV marker). No apunta a prod.
```

Rollback conversación: `AI_CONCIERGE_ENGINE=legacy` en nuevas sesiones. Conversaciones ya pineadas a `n8n` siguen en n8n hasta nueva cookie/`NEW_CONVERSATION`.

---

## 9. Activación futura (no ejecutar)

1. Importar workflow en n8n **aislado** / staging.
2. `AI_CONCIERGE_N8N_MODE=remote` + webhook + secret.
3. Canary por `hs_test` o % de sesiones.
4. Rollback: `AI_CONCIERGE_ENGINE=legacy` — no restaurar DB vieja sobre datos nuevos.

---

## 10. Pendientes

- Import/verify workflow en n8n aislado del VPS (sin tocar prod).
- UI e2e browser del recorrido plomería.
- Reprogram + “cancela todas” + segundo servicio + race de slots.
- Prueba física A06 con config de prueba explícita.
- Extender workflow n8n remoto para escribir `reply_json` del turn (hoy el coordinator local completa el reply; remoto ack parcial).
