# 08 — Homestead Control V1 (local)

Fecha: 2026-10-02 America/Panama. Entrega local sobre `/admin`. No se tocó el VPS.

## Cómo ejecutar

Desde la raíz del repo:

```bash
npm install
npm run control:dev
```

Eso hace, en este orden:

1. Fija `DATA_DIR` a `data/control-dev` y `HOMESTEAD_CONTROL_ISOLATED=true`.
2. Crea fixtures ficticios si no existe `data/control-dev/homestead.sqlite`.
3. Arranca `next dev` con esa base. Contraseña local por defecto: `control-local`.

Luego abre `http://localhost:3000/admin/login` y entra a `/admin` o `/admin/contenido`.

Otras órdenes:

```bash
npm run control:seed   # recrea fixtures sobre data/control-dev (no borra el archivo solo)
npm run control:test   # borra el sqlite aislado, siembra de nuevo y corre aceptación
```

No uses `npm run dev` si quieres aislamiento: ese comando respeta el `.env` habitual y puede apuntar a otra `DATA_DIR`.

El scheduler de producción (n8n / cron del VPS) no lee `data/control-dev`. No ejecutes jobs de publicación del VPS contra esta carpeta.

## Base de implementación

- App existente Next.js 16 en `/admin`. No hay Mini App ni app nativa.
- Motores reutilizados: `content-catalog`, `content-queue` (cadencia 1/día + 36 h, America/Panama), `content-publish`, `tryApproveContentJob` / `tryRejectContentJob`, lotes `HB-`, campañas `CM-`.
- SQLite vía `DATA_DIR`. En Control aislado: `data/control-dev/homestead.sqlite`.
- Los estados visuales se derivan. No se añadieron estados persistentes nuevos.
- `DEPLOYED_SHA` del VPS no se usó como prueba de este build.

Divergencias con producción que siguen abiertas (no resueltas aquí): TLS de n8n/Telegram, backup no ejecutable, identidad del build, permisos Meta. Ver sección de pendientes operativos.

## Aislamiento

`scripts/control-isolated-env.mjs` fija:

- `HOMESTEAD_CONTROL_ISOLATED=true`
- `DATA_DIR=data/control-dev`
- `CONTENT_DRY_RUN=false` (para ejercitar el publicador con transporte simulado)
- Tokens reales de Meta/Telegram/SMTP/OpenAI/n8n vacíos o marcados como no usables
- `AUTOMATION_DISPATCH_ENABLED=false`

Adaptadores simulados en `content-meta`, `content-telegram`, `content-openai`, `mail`, `n8n`. `is_test=1` de campañas no se usó como único freno.

El test de aceptación reemplaza `fetch` y aborta si la URL parece Graph, Telegram, OpenAI o n8n.

## Acciones de contenido

| Acción | Efecto | Notas |
| --- | --- | --- |
| Aprobar | `APPROVED`, sin slot | No convierte APPROVED antiguos a SCHEDULED |
| Aprobar y programar | Aprueba y asigna slot con `assignStaggeredSlots` | Muestra fecha America/Panama |
| Reprogramar | Solo si el job ya está `SCHEDULED` | |
| Rechazar | `tryRejectContentJob` | |
| Publicar ahora | Exige confirmación con preview (pieza, versión, redes, efecto) | En esta entrega, Graph simulado |

Mutaciones: sesión admin + CSRF HMAC + origen. Recibos en `control_action_receipts` (idempotencia). Lock de publicación existente. Si una red ya salió, el reintento solo toca la pendiente. Resultado Graph ambiguo → `UNCERTAIN` / conciliación, no republicar a ciegas.

HC-040 de producción no se modificó. El fixture local `HC-2026-000005` (`job_publication_mismatch`) replica el patrón.

## Lotes

Seis JPEG válidos + un archivo inválido: seis HC- + un fallo aislado + un `HB-`. Dedup por sha256. Validación por magic bytes, tamaño y tope de 8 archivos. El procesamiento corre dentro del request HTTP y persiste archivos + SQLite antes de responder; no hay `setTimeout` en memoria como única garantía. Si el request muere a mitad, el original ya escrito se puede recuperar con `/api/admin/content/jobs/:id/recover`.

Cargar varias fotos ≠ publicarlas a la vez. Sigue la cadencia actual.

Video y carrusel: no implementados y no simulados. Falta almacenamiento de video, transcodificación, publicación Reels/carrusel y un publicador de más de una imagen por pieza.

## Pruebas corridas

`npm run control:test` (2026-10-02, local):

- CTL-01…05 fixtures (pendiente, aprobado sin programar, programado, inconsistencia tipo HC-040, parcial)
- CTL-06 versión obsoleta rechazada
- CTL-07/08 aprobar sin programar
- CTL-09 replay idempotente
- CTL-10/11 aprobar y programar
- CTL-12 APPROVED antiguo no se programa solo
- CTL-13 reprogramar bloqueado si no está SCHEDULED
- CTL-14 pausa bloquea publicar
- CTL-15 preview de redes
- CTL-16/17 Facebook simulado falla; Instagram publica
- CTL-17b reintento solo Facebook pendiente
- CTL-18 Facebook incierto no se marca publicado
- CTL-19…22 lote de 6 + fallo + `HB-` + dedup
- CTL-23…25 CSRF
- CTL-26 Meta simulado (sin red real)
- CTL-27 el guard de red no disparó

No se certificó: login en navegador contra un usuario de producción, publicación real a Meta, video/carrusel, restore de backup, TLS, ni el suite completo de solicitudes/citas. Esas páginas no se reescribieron; los hooks de aislamiento solo actúan con `HOMESTEAD_CONTROL_ISOLATED=true`.

## Plan de despliegue (no ejecutado)

1. Construir la imagen/app Next con este código. No copiar `data/control-dev` al VPS.
2. En producción: `HOMESTEAD_CONTROL_ISOLATED` ausente o `false`. `DATA_DIR` sigue siendo el de prod.
3. Variables admin (`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`) ya requeridas por `/admin`.
4. Tras el deploy, comprobar `/admin/login` → `/admin/contenido` con un operador real. No activar publicación en vivo desde Control hasta revisar token Meta.
5. n8n/cron no cambian. El inbound de Telegram sigue dependiendo del TLS de n8n.

Reversión: volver la imagen/commit anterior. Las tablas nuevas (`control_action_receipts`) son aditivas; no hace falta borrarlas para revertir la UI. No restaurar un sqlite de `control-dev` sobre producción.

## Pendientes operativos (fuera de esta entrega)

| Ítem | Qué falta | Por qué no va aquí |
| --- | --- | --- |
| TLS n8n / webhook Telegram | Renovar certificado de `n8n.autonomousflow.lat` | Producción / infra |
| Backup consistente y restore aislado | `production-backup.sh` no ejecutable; no hay restore de prueba | Permisos y datos reales |
| Identidad del build | `DEPLOYED_SHA` desactualizado | Solo en el próximo deploy |
| Permisos Meta actuales | Fallos `pages_*` en jobs reales | Revisar scopes en Meta Business, sin pegar tokens |

## Limitaciones de V1

- Un solo rol web (sesión admin). No se mapeó IAM a `telegram_operators`.
- La pausa del estudio no se conmuta desde la web; se respeta si ya está pausada.
- El intake es síncrono en el request (durable en disco/SQLite, no es una cola de workers).
- Evidencia visual: capturas locales de escritorio y móvil en `docs/auditoria-homestead-app/evidence/`.
- La página existente de solicitudes tiene ~50 px de overflow horizontal a 390 px (preexistente). Control cola/citas no desbordaron.
- Citas muestra un aviso de hidratación en `UpcomingSection` (preexistente; no se tocó ese archivo).

## Archivos de esta entrega

Nuevos (Control):

- `scripts/control-isolated-env.mjs`, `scripts/run-control-dev.mjs`, `scripts/seed-control-dev.mjs`, `scripts/test-homestead-control.mjs`
- `src/lib/control-isolation.ts`, `src/lib/control-auth.ts`, `src/lib/control-status.ts`, `src/lib/control-service.ts`, `src/lib/control-intake.ts`
- `src/app/admin/contenido/**`, `src/app/api/admin/content/**`, `src/app/api/admin/control/**`
- `src/components/admin/control/**`
- `docs/auditoria-homestead-app/08-HOMESTEAD-CONTROL-V1.md`
- `docs/auditoria-homestead-app/evidence/`

Modificados para reutilizar / aislar (sin reescribir motores):

- `package.json` (`control:dev`, `control:seed`, `control:test`)
- `src/lib/content-meta.ts`, `content-telegram.ts`, `content-openai.ts`, `mail.ts`, `n8n.ts` (adaptadores simulados)
- `src/lib/admin-auth.ts` (CSRF)
- `src/lib/service-requests.ts` (`control_action_receipts`)
- `src/lib/content-catalog.ts` (`isBrandedFeedFilename`)
- `src/lib/content-publish.ts` (reconocer `branded-feed-v*.jpg` y `*-feed.jpg`)
- `src/app/admin/page.tsx`, `src/app/admin/login/page.tsx`
- `src/components/admin/AdminTopBar.tsx`, `AdminMobileNav.tsx`
- `docs/auditoria-homestead-app/07-BACKLOG-Y-BLOQUEOS.md` (puntero a este archivo)

No desplegado. No se modificó el VPS.
