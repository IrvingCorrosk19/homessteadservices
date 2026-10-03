# 09 — Homestead Control V2 + PWA (local)

Fecha: 2026-10-02 America/Panama. Trabajo local sobre `/admin`. **No se tocó el VPS. No se publicó nada real.**

## Estado de esta entrega

| Fase | Estado |
| --- | --- |
| Listo localmente | Sí, con las limitaciones de la matriz |
| Listo para desplegar | Sí, como UI/operación de Control, **sin** autorizar publicación en vivo |
| Desplegado | No |
| Verificado en producción | No |

Árbol usado: último commit `7a962dcdb0bd4b2d9bdf7937e5db41eb10fc8028` **más el working tree sucio de esta entrega**. No hay SHA limpio único. Antes de construir la imagen hay que commitear o etiquetar el árbol.

## Qué implementé

- Experiencia Control identificable dentro de `/admin` (inicio, cola, detalle, lotes, campañas, fallos, carga).
- PWA acotada a `/admin`: manifest, iconos any+maskable, service worker, pantalla genérica sin conexión, ayuda de instalación.
- Aislamiento estricto: `data/control-dev` para `control:dev` y `data/control-test` para pruebas que borran la base. Contraseña `control-local` solo en modo aislado. El arranque normal no la usa.
- Intake durable: persistir `received` → procesar → recuperar por API y por `scheduler-tick`. Deduplicación por actor+sha256.
- Pausa/reanudación del estudio y de campañas reutilizando `setContentPaused` / `pauseCampaign` / `resumeCampaign`.
- Recibos de idempotencia con `request_hash` (misma clave + payload distinto = conflicto).
- Corrección del overflow de solicitudes a 390 px (`min-w-0`, sin `overflow-x: hidden` global).
- Hidratación de citas: `formatAppointmentClock` ahora es `HH:mm` determinista (sin `Intl` con `hour12` implícito).
- Scripts de backup WAL-safe, restore aislado, inspección y preparación de release. **No ejecutados contra producción.**

## Qué corregí respecto de V1

- El informe V1 decía que no añadió estados persistentes, pero hablaba de `UNCERTAIN`. Resolución: **`UNCERTAIN` ya existía en `content_publications.status`**. Control no lo guarda como estado de job. Lo deriva a `partially_published` / `needs_review`. Compatible con jobs viejos, reintentos y consultas.
- Isolation V1 filtraba `fetch` por URL. V2 también vacía tokens, fuerza `control-local`, exige `CONTROL_DEV.txt`, bloquea SMTP/SDK/OpenAI/Telegram/n8n/copilot/concierge/visión, y usa directorios distintos para test y dev.
- Intake V1 era solo síncrono en el request. V2 persiste `control_intake_items` y recupera `received`/`processing`.
- Campañas: listado, detalle, piezas, pausa/reanudación reales. Métricas: “todavía no disponibles”.
- Pausa del estudio desde la web (faltaba en V1).
- Centro de fallos: fallo definitivo / parcial / incierto. Un resultado `UNCERTAIN` **no** sugiere reintentar.
- PWA y offline genérico. El sitio público no tiene `app/manifest.ts`.

## Arquitectura final

```
Navegador / PWA (scope /admin)
    → Next.js 16 admin
        → control-auth (sesión + CSRF + origen)
        → control-service / control-intake / control-status
        → motores existentes (catalog, queue, publish, campaign-engine)
        → SQLite en DATA_DIR
Adaptadores aislados: Meta, Telegram, SMTP, OpenAI, n8n
Recuperación de intake: API + scheduler-tick (n8n/cron existentes)
```

Un solo rol web: administrador. No hay IAM mapeado a `telegram_operators`. La UI no finge roles.

## Rutas

| Ruta | Uso |
| --- | --- |
| `/admin` | Inicio operativo + panel Control |
| `/admin/login` | Acceso |
| `/admin/contenido` | Cola |
| `/admin/contenido/nuevo` | Carga de fotos |
| `/admin/contenido/[publicId]` | Detalle |
| `/admin/contenido/lotes` | Lotes |
| `/admin/contenido/campanas` | Campañas |
| `/admin/contenido/errores` | Centro de fallos |
| `/admin/offline` | Pantalla genérica sin conexión |
| `/admin/manifest.webmanifest` | Manifest (público) |
| `/admin/sw.js` | Service worker (público, scope `/admin/`) |
| `/api/admin/content/*` | APIs de Control (sesión) |

## Cómo ejecutar localmente

```bash
npm install
npm run control:dev
```

Abre `http://localhost:3000/admin/login`. Contraseña aislada: `control-local`.

```bash
npm run control:test        # borra solo data/control-test
npm run control:test:http   # HTTP real (usa :3000 si ya corre control:dev)
npm run control:seed        # fixtures en data/control-dev
npm run control:wipe        # solo data/control-dev, exige CONTROL_DEV.txt
npm run build
```

No uses `npm run dev` si quieres aislamiento.

## Cómo instalar la PWA

1. Entra a `/admin` con sesión.
2. Chrome/Edge de escritorio o Android: menú → Instalar / Añadir a pantalla de inicio. El panel muestra ayuda.
3. iPhone/iPad: Safari → Compartir → Añadir a pantalla de inicio. No hay botón nativo.
4. El icono abre `/admin`. Si la sesión expiró, el middleware manda a `/admin/login`.
5. Sin internet se sirve `/admin/offline`. No hay cola de publicaciones ni aprobaciones offline.

### Distinción de pruebas PWA

| Cosa | Estado |
| --- | --- |
| Manifest validado (HTTP 200, JSON, name/scope/icons) | Hecho en este entorno |
| Navegación interna `/admin` | Hecha en Chromium emulado |
| Service worker registrado en código | Implementado; no se certificó `clients.claim` en dispositivo |
| Instalación en dispositivo real | **No probada** |
| Android / iPhone certificados | **No** |

## Variables nuevas

Ninguna variable de producción nueva es obligatoria.

| Variable | Dónde | Efecto |
| --- | --- | --- |
| `HOMESTEAD_CONTROL_ISOLATED=true` | Solo scripts `control:*` | Activa adaptadores simulados y exige `DATA_DIR` en `control-dev` o `control-test` |
| `NEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED` | Prohibida | Se borra en el arranque aislado para no filtrar al cliente |

Producción: `HOMESTEAD_CONTROL_ISOLATED` ausente o `false`. `DATA_DIR` sigue siendo el de prod. `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` ya requeridos; si faltan, el login responde 503. Nunca cae a `control-local`.

## Tablas o migraciones nuevas

Aditivas, reversibles dejando las tablas:

- `control_action_receipts` + columna `request_hash`
- `control_intake_items` (seguimiento durable de cada archivo: `received` → `processing` → `ready`/`duplicate`/`failed`)

Justificación de `control_intake_items`: el request HTTP no es una cola. Hay que persistir la recepción para recuperar si el proceso muere. No cambia `content_jobs`. Borrar la tabla solo pierde seguimiento de cargas Control, no el catálogo.

## UNCERTAIN

Valor **almacenado** en `content_publications.status` (enum previo). No es estado de `content_jobs`. Control lo usa para:

- no marcar éxito;
- no reintentar a ciegas;
- clasificar el centro de fallos como “Resultado incierto” si hay `UNCERTAIN` o `PUBLISHING`.

Jobs históricos sin esa fila siguen iguales.

## Resultados de pruebas

`npm run control:test` (2026-10-02, `data/control-test`): CTL-01…40 **PASS**.

`CONTROL_HTTP_BASE=http://127.0.0.1:3000 npm run control:test:http`: HTTP-01…14 **PASS**.

`npm run build`: compiló. TypeScript OK. Aviso de Next 16: `middleware` está deprecado a favor de `proxy`; no se migró en esta fase.

Backup drill aislado: `BACKUP_DRILL_OK`, restore en `data/control-dev/restore-drill/…`, integrity ok.

Navegador (Chromium emulado, 360/390): inicio, cola, detalle HC-2026-000012, campañas CM-2026-000001, errores, solicitudes (overflow 0 px), citas, offline, carga de fotos (`capture` ausente).

## Evidencia visual

En `docs/auditoria-homestead-app/evidence/`:

- `v2-inicio.png`, `v2-cola.png`, `v2-solicitudes-390.png`, `v2-offline.png`
- Capturas V1 previas (`desktop-*`, `mobile-*`) no se toman como certificación de V2

Las capturas no contienen secretos. Los folios son de demostración.

## Limitaciones reales

- Un solo administrador web.
- Logout borra cookies; el token HMAC sigue siendo válido si alguien lo reenvía hasta que expire (7 días).
- No hay “exactamente una vez” en publicación: caída después de éxito Meta y antes de persistir queda `UNCERTAIN` / conciliación.
- Video y carrusel fuera de alcance. La UI lo dice y no simula soporte.
- No se programa automáticamente un `APPROVED` antiguo.
- Publicar ahora en este entorno usa Graph simulado.
- PWA no cachea APIs ni páginas privadas; sin internet no hay datos vivos.
- Instalación real en teléfono: no verificada.
- TLS n8n, permisos Meta y `DEPLOYED_SHA` del VPS: tareas operativas aparte.

## Archivos modificados o nuevos (esta fase)

Nuevos relevantes:

- `src/app/admin/contenido/**`, `src/app/admin/offline/**`, `src/app/api/admin/content/**`, `src/app/api/admin/control/**`
- `src/lib/control-*.ts`
- `src/components/admin/control/**`
- `public/admin/manifest.webmanifest`, `public/admin/sw.js`, `public/admin/icons/*`
- `scripts/control-*.mjs`, `scripts/test-homestead-control*.mjs`, `scripts/wipe-control-dev.mjs`, `scripts/generate-control-pwa-icons.mjs`, `scripts/inspect-production-backup.mjs`, `scripts/prepare-control-release.mjs`
- este archivo

Compartidos tocados con cuidado:

- `src/lib/admin-auth.ts`, `service-requests.ts`, `appointment-time.ts`
- `src/lib/content-meta.ts`, `content-telegram.ts`, `content-openai.ts`, `mail.ts`, `n8n.ts`
- `src/lib/campaign-engine.ts` (`resumeCampaign`)
- `src/lib/copilot/openai.ts`, `concierge-engine.ts`, `autonomous/analyzer.ts`, `concierge/digital-lock-vision.ts` (cortan outbound si aislado)
- `src/middleware.ts`, `next.config.ts`, `package.json`
- `src/app/admin/layout.tsx`, login, dashboard, solicitudes
- `scripts/production-backup.mjs`, `production-restore.mjs`

## Procedimiento de despliegue (no ejecutado)

1. Commitear o etiquetar el árbol. Anotar SHA.
2. Anotar la imagen/commit **actual** de producción para revertir.
3. `node scripts/inspect-production-backup.mjs` en el VPS (Linux: revisar uid/gid/mode; no basta `chmod +x`).
4. Backup WAL-safe: `DATA_DIR=/ruta/prod node scripts/production-backup.mjs --dest /ruta/backups/STAMP`. Verificar `manifest.json` + `integrity: ok`.
5. Restore de prueba **solo** en destino aislado: `node scripts/production-restore.mjs --from BACKUP --dest /tmp/homestead-restore-drill --force`. Nunca sobre `DATA_DIR` de prod.
6. Construir imagen con el Dockerfile existente. `.dockerignore` ya excluye `data`. No copiar `data/control-dev` ni `data/control-test`.
7. En el contenedor: `HOMESTEAD_CONTROL_ISOLATED` ausente. No definir `NEXT_PUBLIC_HOMESTEAD_CONTROL_ISOLATED`.
8. Migraciones aditivas corren al abrir SQLite. No requieren paso manual.
9. n8n/Telegram/cron no cambian. El scheduler existente llama `recoverControlIntake`.
10. Health: `/api/health`, `/admin/login` → `/admin/contenido` con operador real.
11. **No** publicar ni reintentar piezas históricas desde Control hasta revisar token y permisos Meta actuales.

Reversión: volver imagen/commit anterior. Dejar las tablas nuevas. No restaurar sqlite de `control-dev` sobre producción.

## Bloqueos pendientes (operativos, no de esta fase)

| Ítem | Qué falta |
| --- | --- |
| TLS n8n / webhook Telegram | Diagnóstico en el VPS; un error SSL no implica certificado vencido |
| Permisos Meta actuales | No afirmar que scopes viejos siguen vigentes |
| Identidad del build en prod | `DEPLOYED_SHA` desactualizado hasta el próximo deploy |
| Instalación PWA en teléfono real | Pendiente del operador |
| Publicación en vivo desde Control | Requiere verificación Meta; el deploy de UI no la autoriza |

## Matriz requisito → implementación → prueba → evidencia → estado

| Requisito | Implementación | Prueba | Evidencia | Estado |
| --- | --- | --- | --- | --- |
| Seguir sobre `/admin` | Sin segundo proyecto | Recorrido `/admin/contenido` | Snapshot cola | PASS |
| Sitio público intacto | Sin `app/manifest.ts` | Build lista `/` y `/admin` | `next build` | PASS |
| Aislamiento de datos | `control-dev` / `control-test` + `CONTROL_DEV.txt` | CTL-28, wipe EPERM evitado | test log | PASS |
| Sin credenciales de prod en test | Tokens vaciados, `assertIsolatedSecretsCleared` | CTL-29 | test log | PASS |
| `control-local` solo aislado | `applyControlIsolatedEnv` fuerza; login 503 si falta secreto | HTTP-03; código `isAdminAuthConfigured` | HTTP log | PASS |
| Adaptadores simulados (fetch, SMTP, SDK) | Meta/Telegram/mail/OpenAI/n8n/copilot/concierge | CTL-26, guard de red | test log | PASS |
| Contadores = listados | `controlHomeSummary` usa `listControlJobs` | CTL-30 | test log | PASS |
| Cola: filtros, folio, thumbs, paginación | `page.tsx` + `paginateControlJobs` | Recorrido + from= | `v2-cola.png` | PASS |
| Detalle: imagen, texto, redes, acciones | `ControlJobActions` + permalinks | HC-2026-000012 | snapshot | PASS |
| No auto-programar APPROVED viejos | `approve` no asigna slot | CTL-12 | test log | PASS |
| Campañas reales | listado/detalle/pausa/`resumeCampaign` | CTL-33…35, HTTP-09 | snapshot CM- | PASS |
| Métricas no inventadas | Texto fijo | Detalle campaña | snapshot | PASS |
| Centro de fallos 3 clases | `classifyControlFailure` (incierto gana) | CTL-18, UI errores | snapshot | PASS |
| Pausa estudio | `setStudioPaused` + API + CSRF | CTL-31/32, HTTP-06/07 | HTTP log | PASS |
| PWA manifest | `/admin/manifest.webmanifest` | HTTP-12 | JSON 200 | PASS |
| SW scope `/admin`, sin cache auth | `public/admin/sw.js` | HTTP-13; revisión de código | código | PASS |
| Offline genérico | `/admin/offline` | HTTP-14, `v2-offline.png` | captura | PASS |
| Instalación dispositivo real | Ayuda en UI | — | — | NO PROBADO |
| Standalone en teléfono | `display: standalone` | Solo emulación | — | NO PROBADO |
| Overflow solicitudes 390 | `min-w-0` local | CDP overflow=0 | `v2-solicitudes-390.png` | PASS |
| Overflow 360 / citas | mismo enfoque | CDP 360=0, citas=0 | CDP | PASS |
| 430 / tablet / teclado / contraste | no se recorrió 430 ni teclado físico | — | — | PARCIAL |
| Hidratación citas | `HH:mm` fijo | Página citas carga | snapshot | PASS |
| Fotos galería+cámara | `accept` sin `capture` | CDP `hasCapture:false` | CDP | PASS |
| Lote 6 + inválido | `ingestControlPhotos` | CTL-19…21 | test log | PASS |
| Dedup por actor | `findActorOriginal` | CTL-22, CTL-38 | test log | PASS |
| Recuperación durable | `control_intake_items` + recover | CTL-37 | test log | PASS |
| Sesión/CSRF | middleware + HMAC | HTTP-01,05,11; CTL-23…25 | HTTP log | PASS |
| Mutación ≠ lectura | `requireAdminMutation` | HTTP-05/06 | HTTP log | PASS |
| Idempotencia con hash | `request_hash` | CTL-09, CTL-36 | test log | PASS |
| Concurrencia 2 pestañas / Telegram / scheduler | doble clic cubierto por busy+recibo; Telegram/scheduler no ejercidos juntos | CTL-09 | — | PARCIAL |
| Publicación parcial | escenario `fail_facebook` | CTL-16/17/17b | test log | PASS |
| Resultado incierto | `uncertain_facebook` | CTL-18, CTL-40 | test log | PASS |
| No “exactamente una vez” | documentado; UNCERTAIN | — | este doc | PASS |
| Build producción | `npm run build` | 2026-10-02 | log Next 16.3.1 | PASS |
| Backup WAL + restore aislado | `control-backup-drill` | integrity ok | drill log | PASS |
| Excluir fixtures del deploy | `.dockerignore` `data` | `prepare-control-release` | RELEASE_PREP_OK | PASS |
| n8n/Telegram intactos | sin workflows nuevos | revisión | código | PASS |
| No desplegar / no prod | esta fase | — | — | PASS |

Leyenda: PASS / FAIL / PARCIAL / NO PROBADO.
Desplegado = no. Verificado en producción = no.
