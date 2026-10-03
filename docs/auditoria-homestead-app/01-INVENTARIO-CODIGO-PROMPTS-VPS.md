# 01 — Inventario de código, prompts e infraestructura VPS

**Entorno local:** `C:\Proyectos\HOMESTEAD SERVICES` · 2026-10-02.  
**Entorno VPS:** `vmi3027483` · 2026-10-02 19:43 America/Panama.  
**Cambios en esta fase:** ninguno en producción. Se crearon solo documentos locales y scripts de lectura en `/tmp` del VPS.

---

## 1. Repositorio local

| Ítem | Valor | Estado |
| --- | --- | --- |
| Remote | `https://github.com/IrvingCorrosk19/homessteadservices.git` | **VERIFICADO** `git remote` |
| Rama | `main` tracking `origin/main` | **VERIFICADO** |
| HEAD local | `7a962dcdb0bd4b2d9bdf7937e5db41eb10fc8028` · 2026-09-22 05:27 -0500 · `fix(contact): restore digital-lock validation imports for campaign form.` | **VERIFICADO** |
| Working tree | Sucio: cambios de Content Studio/campañas/scripts + muchos untracked (canaries VPS, media, `src/lib/content-photo-batch.ts`) | **VERIFICADO** `git status` |
| Archivo `DEPLOYED_SHA` en VPS | `d98df0d5aad619b0a3c924ac75b1920e5e6d8f7b` (commit 2026-08-22) | **VERIFICADO** y **desactualizado** |
| Imagen `homestead_web` | Creada `2026-09-22T14:00:24Z` | **VERIFICADO** `docker inspect` |

**Consecuencia:** el SHA del archivo `DEPLOYED_SHA` no identifica el contenedor que corre. El árbol local tiene lógica de lotes fotográficos **no commiteada** que **sí** aparece en SQLite de producción (`content_photo_batches`, HC-029…). El código desplegado no es el HEAD limpio de Git.

Instrucciones del repo leídas: `AGENTS.md` (aviso Next.js 16 / docs en `node_modules/next/dist/docs/`), `CLAUDE.md` → `@AGENTS.md`. No hay `.cursor/rules` en el árbol.

---

## 2. Stack y versiones

| Pieza | Local (código) | VPS (ejecución) | Estado |
| --- | --- | --- | --- |
| Next.js | 16.3.1 | contenedor `homestead-homestead_web` | **VERIFICADO** |
| React | 19.2.8 | mismo build | **VERIFICADO** |
| TypeScript | ^5 (dev) | build-time | **VERIFICADO** |
| Tailwind | 4 | CSS compilado | **VERIFICADO** |
| SQLite | `better-sqlite3` ^11.10.0 | `/opt/apps/homestead/data/homestead.sqlite` | **VERIFICADO** |
| SMTP | `nodemailer` ^9 | `SMTP_PASS=SET`, host por defecto `mail.privateemail.com` | **PARCIAL** (nombre SET, no se envió correo) |
| OpenAI | `OPENAI_TEXT_MODEL=gpt-4o`, `OPENAI_IMAGE_MODEL=gpt-image-1` | ambos SET + `OPENAI_API_KEY=SET` | **VERIFICADO** flags |
| n8n | JSON export en `n8n/` | `n8nio/n8n:2.3.6`, CLI 2.3.6 | **VERIFICADO** |
| Postgres n8n | — | `postgres:15-alpine`, `5434→5432` | **VERIFICADO** |
| Meta Graph | `v22.0` en compose | `META_GRAPH_VERSION=v22.0`, token e IDs SET | **VERIFICADO** flags |
| Node imagen | Dockerfile Alpine | no se abrió el Dockerfile en runtime | **PARCIAL** |

---

## 3. Estructura de producto

```text
src/app/(public)     sitio: /, /services, /contact
src/app/admin        panel: dashboard, solicitudes, clientes, citas, trabajos, retención, copilot, operadores
src/app/api          público + admin + internal
src/lib              motores (contenido, campañas, revenue, ops, concierge, outbox)
n8n/*.json           7 exports Homestead (2 no importados)
deploy/vps           compose, Dockerfile, canaries, inspectores
docs/ + docs/AUDIT   certificaciones (históricas)
scripts/             tests de comportamiento (no e2e de Meta)
```

### Páginas públicas — **VERIFICADO** en código

| Ruta | Archivo | Función |
| --- | --- | --- |
| `/` | `src/app/(public)/page.tsx` | Home |
| `/services` | `src/app/(public)/services/page.tsx` | Servicios |
| `/contact` | `src/app/(public)/contact/page.tsx` | Formulario → `POST /api/contact` |

### Admin web — **VERIFICADO** en código; **PARCIAL** en ejecución (sin login)

| Ruta | Propósito |
| --- | --- |
| `/admin` | Dashboard / Attention Center |
| `/admin/login` | Sesión `ADMIN_PASSWORD` |
| `/admin/solicitudes` + `[requestId]` | Folios HS- |
| `/admin/clientes` + `[customerId]` | Customer 360 |
| `/admin/citas` | HA- |
| `/admin/trabajos` + `[jobId]` | HJ- |
| `/admin/retencion` | Recovery |
| `/admin/copilot` | Copilot de operador |
| `/admin/configuracion/operadores` | `telegram_operators` |

**No encontrado** en `src/app/admin/`: cola Content Studio, campañas CM-/CP-, publicaciones Meta, programación de piezas. Buscado por glob `src/app/admin/**`.

### APIs internas (efecto secundario)

Auth: `verifyInternalHomesteadRequest` (`src/lib/internal-auth.ts`) — secreto + timestamp ±300 s. HMAC solo si viene header (n8n 2.3.6 no firma HMAC inbound).

| Ruta | Efecto | Invocado en esta fase |
| --- | --- | --- |
| `POST …/scheduler-tick` | Drain outbox, ops, retención, autónomo, **publica** due, Telegram reminders | **No** (el cron n8n ya lo hace) |
| `POST …/telegram-update` | Router completo del bot | **No** |
| `POST …/publish-live` | Meta live si `confirm=LIVE` | **No** |
| `POST …/photo-batch-recover` | Recupera lote + IA + Telegram | **No** |
| `POST …/campaign-ops` | Canary; 403 si no dry-run | **No** |
| `GET /api/health` | Liveness, sin mutación | **Sí** — 200 |
| `GET /api/internal/ops/summary` y `lists` | Lectura | **No** (evitar secretos en headers) |

`GET /api/health` se comprobó en código (`livenessPayload`) **antes** de invocarlo.

---

## 4. Documentos históricos pedidos

| Documento | Ubicación | Fecha | Estado hoy |
| --- | --- | --- | --- |
| HOMESTEAD-AUTOMATION-V2-WAVE-B-CERTIFICATION.md | `docs/AUDIT/` | 2026-08-22 | **HISTÓRICO.** Certifica Command Center / lead rescue / SLA. “WAVE B CERTIFIED”. |
| HOMESTEAD-AUTOMATION-V2-WAVE-C-CERTIFICATION.md | `docs/AUDIT/` | 2026-08-22 | **HISTÓRICO.** Jobs / post-service. Dice que campañas y Meta **no** estaban hechos **en esa fecha**. |
| AUDITORIA_CONTENIDO_HOMESTEAD_N8N.md | raíz | 2026-09-21 | **HISTÓRICO y parcialmente superado.** Afirmaba Meta vacío e IG sin `image_url`. El 22-sep `CERTIFICACION_OPERATIVA_HOMESTEAD_CAMPANIAS.md` lo declara desactualizado. Hoy token/IDs SET y hay publicaciones live. |
| HOMESTEAD-N8N-MASTER-AUTOMATION-AUDIT.md | `docs/AUDIT/` | 2026-08-22 | **HISTÓRICO.** Inventario de 16 workflows; Content Studio ID entonces `l10Rh1i8NDrdkfUa`. Hoy el ID vivo es `x9PZMUr4NNvvlv8i`. |
| HOMESTEAD-N8N-TELEGRAM.md | `docs/` | producto | **CÓDIGO/DOC vigente** para solicitudes → n8n. El inbound de Content Studio es otro webhook. |
| CERTIFICACION_OPERATIVA_HOMESTEAD_CAMPANIAS.md | raíz | 2026-09-22 05:39 | **HISTÓRICO.** Dry-run global `true`, Meta EMPTY. **Hoy** `CONTENT_DRY_RUN=false` y Meta SET. |

Otras certificaciones en `docs/AUDIT/` (conversational, zero-defect, go-live) se catalogan como **HISTÓRICO** salvo que un hallazgo vivo las confirme.

---

## 5. Clasificación de prompts

### 5.1 Instrucciones históricas de desarrollo

| Ubicación | Uso | Estado |
| --- | --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Convención Next.js 16 | **VERIFICADO** |
| `docs/AUDIT/*CERTIFICATION*.md` | Playbooks de oleadas | **HISTÓRICO** |
| `docs/ARCHITECTURE/HOMESTEAD-AUTOMATION-V2-PROPOSAL.md` | Diseño Wave A–C | **HISTÓRICO** |
| Mensajes de canary / `deploy/vps/*.py` | Operación humana pasada | **No ejecutar** como autorización actual |

### 5.2 Prompts ejecutados por la aplicación

| Módulo | Archivo | Modelo | Entrada → salida | Herramientas | Estado |
| --- | --- | --- | --- | --- | --- |
| Content Studio editor | `src/lib/content-openai.ts` SYSTEM L43+ | `OPENAI_TEXT_MODEL` default `gpt-4o` | Foto + nota → JSON copy/CTA/hashtags. Prohibe inventar precios/garantías | Chat Completions | **VERIFICADO** código; **PARCIAL** ejecución (usage 85 filas) |
| Imagen de campaña | mismo, `gpt-image-1` | `OPENAI_IMAGE_MODEL` | Prompt EN → imagen | Images API | **PARCIAL** (créditos fallaron históricamente en HC-018) |
| Concierge | `concierge-knowledge.ts` + `concierge-engine.ts` · `CONCIERGE_PROMPT_VERSION=hs-concierge-v3.2-nc` | `OPENAI_CONCIERGE_MODEL` → text | Turno web → respuesta + tools | `CONCIERGE_TOOLS` | **VERIFICADO** código; 8 conversaciones vivas |
| Visión cerradura | `concierge/digital-lock-vision.ts` | mismo | Foto → JSON | Vision | **PARCIAL** |
| Copilot operador | `copilot/prompt.ts` `BUSINESS_COPILOT_SYSTEM` | `OPENAI_COPILOT_MODEL` | Pregunta ops → tools | tools copilot | **PARCIAL** (3 filas `copilot_audit`) |
| Autonomous analyzer | `autonomous/analyzer.ts` | copilot/text | Señales | — | **PARCIAL** (6 signals, dry-run) |

**Dependencia común:** `OPENAI_API_KEY`. No se invocó OpenAI en esta auditoría.

### 5.3 Prompts en workflows n8n

**NO ENCONTRADO.** Los 7 JSON Homestead no contienen nodos OpenAI/LangChain. n8n no genera copy. Buscado en `n8n/*.json` (nodos HTTP + Telegram + Schedule + Code de formato).

### 5.4 Reglas de negocio en código (no prompt)

| Regla | Dónde | Gana sobre el prompt |
| --- | --- | --- |
| Folio HS/HC/HB/CM/CP | counters SQLite | Sí |
| Cadencia 1 post/día, 36 h, 18:00–20:00 Panama | `content_settings` + `content-scheduler.ts` | Sí |
| Aprobación humana + versión | `tryApproveContentJob`, callbacks `:vN` | Sí |
| DRY RUN / `live_once` / pause | `content-publish-policy.ts` | Sí |
| Claims comerciales | `scanCommercialClaims` | Sí |
| Carrusel no soportado | `content-photo-batch.ts`, `content-publish.ts` | Sí |
| Outbox idempotente | `idempotency_key UNIQUE` | Sí |
| RBAC Telegram | `telegram-operators.ts` `ROLE_PERMISSIONS` | Sí |
| Chat privado only | `content-handler.ts` | Sí |
| n8n HMAC inbound imposible en 2.3.6 | `internal-auth.ts` L29–35 | Sí |

**Contradicción resuelta:** `docs/HOMESTEAD-CONTENT-STUDIO.md` dice “V1 no publica”. El código y el VPS **sí publican**. Gana el runtime (`CONTENT_DRY_RUN=false` + filas PUBLISHED).

---

## 6. Inventario VPS (solo Homestead + n8n compartido)

### 6.1 Confirmación de servidor

| Comprobación | Resultado | Estado |
| --- | --- | --- |
| IP conocida / host | `164.68.99.83` / `vmi3027483` | **VERIFICADO** |
| Dominio | `homestead.lat` TLS Nginx → `homestead_next` → `127.0.0.1:3091` | **VERIFICADO** |
| Preview | `:8094` (README) | **PARCIAL** (no se abrió) |
| n8n UI | `n8n.autonomousflow.lat` · host `8083:5678` · `/healthz` `{"status":"ok"}` | **VERIFICADO** |

Otras apps en el mismo host (asambleas, precare, nexora, westmont, restbar, compliance360): **no inspeccionadas**. Relación documentada: **n8n es compartido** (workflows BrokerPro inactivos en la misma DB).

### 6.2 Mecanismo de proceso

| Ítem | Evidencia | Estado |
| --- | --- | --- |
| Docker Compose Homestead | `/opt/apps/homestead/deploy/vps/docker-compose.yml` | **VERIFICADO** |
| Contenedor | `homestead_web` · `127.0.0.1:3091→3000` · restart unless-stopped | **VERIFICADO** |
| n8n compose | `/opt/apps/n8n/docker-compose.yml` · `n8n_n8n` + `n8n_postgres` | **VERIFICADO** |
| PM2 | no | **NO ENCONTRADO** en `systemctl` / `docker ps` Homestead |
| systemd Homestead | no unit propia; `docker.service` + `nginx.service` | **VERIFICADO** |

### 6.3 Flags de configuración (valores no secretos)

Leídos con `docker exec homestead_web printenv <KEY>` → SET/EMPTY o flag.

| Flag | Valor | Consecuencia |
| --- | --- | --- |
| CONTENT_STUDIO_ENABLED | true | Panel contenido habilitado |
| CONTENT_MODE | ASSISTED | Scheduler publica due si no pause |
| CONTENT_DRY_RUN | **false** | Live |
| CONTENT_PUBLISH_ENABLED | true | Kill switch off |
| CONTENT_TIMEZONE | America/Panama | Cadencia |
| AUTOMATION_DISPATCH_ENABLED | true | Outbox drena |
| AI_CONCIERGE_ENABLED / DRY_RUN | true / **false** | Concierge live |
| REVENUE_ENGINE_DRY_RUN | true | Revenue mutaciones contenidas |
| MARKETING_INTELLIGENCE_DRY_RUN | true | Shadow |
| AUTONOMOUS_OPERATIONS_DRY_RUN | true | Señales, no acciones de riesgo |
| AUTONOMOUS_DEFAULT_LEVEL | NOTIFY_ONLY | — |
| TELEGRAM_BOT_TOKEN, META_*, OPENAI_*, SMTP_PASS, ADMIN_PASSWORD, N8N_HOMESTEAD_WEBHOOK_SECRET, FACEBOOK_PAGE_ID, INSTAGRAM_ACCOUNT_ID | SET | Integraciones presentes |

`content_settings` SQLite: timezone Panama, mode ASSISTED, dry_run **0**, paused **0**, max 1/día, min 36 h.

### 6.4 Disco y backups

| Ruta | Observación | Estado |
| --- | --- | --- |
| `/opt/apps/homestead` | Worktree de deploy + data | **VERIFICADO** |
| `/opt/apps/homestead/data/homestead.sqlite` | 2 023 424 B + WAL 4 124 152 B + shm | **VERIFICADO** |
| `homestead.sqlite.malformed-20260922` | Copia de incidente | **VERIFICADO** existencia |
| Cron `15 3 * * * …/production-backup.sh` | Script **sin bit de ejecución** (`-rw-rw-rw-`). Log: `Permission denied` cada madrugada, última línea `2026-10-02 03:15` | **VERIFICADO** |
| Backups ad-hoc | Último Homestead fechado `homestead-pre-photo-batch-20260922-135846`. No hay `/opt/backups/202610*` | **VERIFICADO** |
| Backup n8n master-audit | `/opt/backups/n8n/master-audit-20260822-0241/` | **HISTÓRICO** |
| Restore off-box | — | **NO ENCONTRADO** |
| Retención cron | `BACKUP_RETAIN_COUNT=7` en script | **PARCIAL** (el cron no completa) |

El script usa `sqlite3.backup()` (correcto con WAL) **si se ejecutara**. Hoy no se ejecuta.

### 6.5 Logs

| Fuente | Política | Estado |
| --- | --- | --- |
| n8n executions | `EXECUTIONS_DATA_PRUNE` histórico 7 días | **HISTÓRICO** en master audit; coherente con solo 3 workflows Homestead con filas |
| `homestead-backup.log` | append diario, 2739 B | **VERIFICADO** |
| Docker logs `homestead_web` | no volcados (PII/secretos) | **NO inspeccionado a propósito** |

---

## 7. Hallazgos de infraestructura que importan a la app nueva

1. **El inbound Telegram depende de TLS de n8n**, no de Homestead. Una app web no hereda ese fallo; el bot sí.  
2. **El backup nocturno está roto por permisos.** Cualquier diseño nuevo debe asumir que el restore más reciente útil es 22-sep + WAL actual.  
3. **Git ≠ producción.** Diseñar contra APIs del contenedor, no contra el working tree sucio.  
4. **n8n compartido.** No usar la API admin de n8n desde el navegador; no activar workflows ajenos.
