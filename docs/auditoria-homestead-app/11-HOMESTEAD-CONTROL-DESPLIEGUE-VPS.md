# 11 — Homestead Control desplegado en el VPS

Fecha de verificación: 2026-10-02 21:45 America/Panama.

## Identidad

| Dato | Valor |
| --- | --- |
| Rama | `main` (`origin/main`, `https://github.com/IrvingCorrosk19/homessteadservices.git`) |
| Commit desplegado | `bc61142f610e2690d9b1e28083c84eb38b345456` |
| Imagen en ejecución | `sha256:71080380350d7542c404740fe68e77aaf4765ac6836dee9a7e672237095e6a92` |
| Etiqueta | `homestead-homestead_web:latest` |
| Imagen anterior | `homestead-homestead_web:pre-control-20261002-212845` (`d0d526f8f625`) |
| `DEPLOYED_SHA` | `bc61142f610e2690d9b1e28083c84eb38b345456` |
| Servicio | `homestead_web` único, `127.0.0.1:3091`, proxy nginx `homestead.lat` |
| `DATA_DIR` | `/app/data` → `/opt/apps/homestead/data` |
| Aislamiento | `HOMESTEAD_CONTROL_ISOLATED` ausente. `control-local` no es la clave de producción |
| Publicación | `CONTENT_DRY_RUN=false`, `CONTENT_MODE=ASSISTED`, `CONTENT_PUBLISH_ENABLED=true` (sin cambio) |

No hay workflows de GitHub. El push no despliega solo. El contenedor se reemplazó con el compose existente, sin segundo proceso de publicación.

## Respaldo y restauración

| Copia | Resultado |
| --- | --- |
| `/opt/backups/homestead-pre-control-20261002-212845` | SQLite vía API `backup` (WAL). Integridad `ok`. 6 solicitudes, 2 citas, 43 piezas. Medios `photos`, `content`, `concierge`, `jobs`. `.env` conservado fuera de Git |
| Restauración aislada | `/tmp/hs-restore-test-20261002-212845`. Integridad `ok`, mismos conteos. No se copió encima de producción |
| Nocturno | El log histórico tenía `Permission denied`. El script quedó `root:root` modo `750`, texto POSIX, y una ejecución real escribió `/opt/backups/20261003-024328` con integridad `ok` |
| Marca de salud | El fallback de Python ahora guarda `last_backup_at`. `/api/ready` pasó de `backup.lastAt=null` a `2026-10-03T02:43:29Z` y `degraded=false` |

Retención del cron: `BACKUP_RETAIN_COUNT` por defecto 7. Horario sin cambio: `15 3 * * *`.

## Migraciones

Aditivas al abrir SQLite en el contenedor nuevo: `admin_sessions` y `control_intake_items` (`CREATE TABLE IF NOT EXISTS`). Tras el arranque había 1 sesión y 0 ítems de intake. Conteos de negocio iguales al respaldo: 6 solicitudes, 2 citas, 43 piezas. Integridad `ok`.

## Matriz de paridad

Web, Telegram y el scheduler usan `content-catalog`, `content-publish` (`publishJob`, `nextPlatformAttempt`) y `content-handler` / `control-service`. Control no tiene un segundo publicador.

| Función | Telegram | Control web | Servicio | Prueba | Estado |
| --- | --- | --- | --- | --- | --- |
| Crear pieza desde imagen | foto → HC- | carga en `/admin/contenido/nuevo` | intake + catalog | CTL aislado; formulario visto en dominio, sin enviar | PASS código / PARCIAL dominio (sin escritura) |
| Texto con la integración existente | `process` / regen | la pieza muestra el texto ya generado | mismo pipeline de copy | detalle HC-2026-000028 en dominio | PASS lectura |
| Previsualizar imagen, texto y redes | ficha del bot | detalle: texto, CTA, instagram y facebook por separado | `toControlJobCard` | navegador, pieza real existente | PASS |
| Aprobar versión vigente | `cs:approve` | botón Aprobar | `tryApproveContentJob` | CTL-41 | PASS aislado |
| Aprobar y programar | lote / slot | botón Aprobar y programar | `scheduleJob`, idempotente si ya hay slot | CTL-43 | PASS aislado |
| Reprogramar | `slot` / `date` | acción `reschedule` | mismo scheduler de slots | código + CTL | PASS aislado |
| Rechazar | `reject` | botón Rechazar | `tryRejectContentJob` | CTL | PASS aislado |
| Publicar ahora con confirmación | `now` / `liveyes` | exige `confirm` | `publishJob` | HTTP/CTL aislado. No pulsado en producción | PASS aislado / NO PROBADO en vivo |
| Seis fotos como lote | álbum | el formulario lo indica; máximo 8 | una HC- por archivo + lote HB- | CTL intake. No se cargó lote en producción | PASS aislado |
| Cadencia existente | settings | no se cambió la cadencia global | `assignStaggeredSlots` | cola muestra horarios distintos | PASS lectura |
| Pausar y reanudar estudio | `/pausa` `/reanudar` | Pausar estudio en inicio | `setContentPaused` | HTTP-06/07 aislado. No se pausó producción | PASS aislado |
| Campañas | `/campana` | `/admin/contenido/campanas` | `pauseCampaign` / `resumeCampaign` | CM-2026-000002 visible. No se pausó | PASS lectura |
| Resultado por red | texto del bot | lista instagram y facebook | `content_publications` | HC-2026-000028: ambas `FAILED` por permisos de Página | PASS lectura |
| Enlace cuando existe | permalink | el detalle lo muestra si hay permalink | `publishJob` | esta pieza falló antes de tener enlace | PARCIAL |
| Reintentar solo la red fallida | retry | «Reintentar red pendiente» | `nextPlatformAttempt`: `PUBLISHED` se omite, `FAILED` se reintenta | no se pulsó en producción | PASS código / NO PROBADO en vivo |
| No republicar lo completado | skip | misma regla | `skip_published` | CTL-39 y `nextPlatformAttempt` | PASS aislado |
| Incierto | no reintenta a ciegas | bloquea retry si hay `UNCERTAIN` | `reconcile_uncertain` | CTL-40 | PASS aislado |
| Video, Reels, carrusel | no | aviso visible en cola, carga y detalle | el publicador solo envía un JPEG | texto visto en dominio | PASS (fuera de alcance) |

## Dónde se probó

### Local / aislado (mismo commit, informe 10)

`data/control-test` y `http://127.0.0.1:3000` con proveedores simulados. CTL-01…44 y HTTP-01…14 más reutilización del token revocado. No se repitieron en este ciclo: el código de la app no cambió después de ese resultado. El único cambio posterior es el script de respaldo del host.

### VPS aislado

No hizo falta un segundo contenedor de escritura. `is_test` no saca las piezas del scheduler ni de Meta, así que no se crearon registros sintéticos en la base de producción.

### Dominio real (lectura, navegación, autenticación)

- Público: inicio, servicios, formulario visible, chat abierto y cerrado sin enviar mensaje.
- `/admin/login`, inicio, solicitudes, citas (calendario, sin quedar en «Cargando»), cola, detalle, lotes, campañas, errores, carga de fotos.
- Sin sesión: `/admin` y `/admin/contenido` redirigen a login. API de contenido sin cookie: 401.
- Login con la clave ya configurada: 200. Mutación sin CSRF: 403. Logout: 200 y el navegador volvió a login. Reenviar la cookie revocada: 401.
- `control-local` no autentica fuera de aislamiento.
- Desbordamiento horizontal 0 en 360, 390, 430, 768 y escritorio (~1265 px) en las pantallas medidas (solicitudes, cola, carga).
- Service worker `control-pwa-v2`, estado `activated`, alcance `https://homestead.lat/admin/`, cabecera `Service-Worker-Allowed: /admin/`.
- Caché persistente: solo `/admin/offline`, manifest e iconos. Sin APIs, colas, solicitudes ni medios de clientes.
- `https://homestead.lat/` no tiene controller del worker.
- Sin conexión solo en el navegador de prueba: la pantalla genérica «Sin conexión» salió desde caché. Una navegación en frío a `/admin` con la red ya cortada mostró el error del navegador, no esa pantalla.
- La actualización del worker pide confirmación si hay un formulario con datos. No se forzó un cambio de versión durante una carga.
- Instalación en teléfono físico: **NO PROBADO**.

No se publicaron posts, no se enviaron mensajes a clientes y no se reintentaron piezas históricas. El scheduler no se invocó a mano. Su último tick observado en el contenedor nuevo fue `2026-10-03T02:40:33Z`, con un solo `homestead_web`.

## Meta

| Nivel | Estado |
| --- | --- |
| 1. Configuración presente | PASS. Token presente, no mostrado. Página `1390930010760052`. Instagram `17841418928294546`. Graph `v22.0` |
| 2. Acceso y permisos | FAIL. `GET /me`, la página y la cuenta de Instagram respondieron 400: Graph exige alguno de `pages_read_engagement`, `pages_manage_metadata`, `pages_read_user_content`, `pages_manage_ads`, `pages_show_list` o `pages_messaging`. `debug_token` con el mismo token también falló, así que tipo, caducidad y lista de scopes quedan **NO PROBADO** |
| 3. Publicación simulada | PASS en el entorno aislado del commit. No es una publicación real |
| 4. Publicación real | **NO PROBADO**. Piezas ya existentes, por ejemplo HC-2026-000028, siguen `FAILED` en instagram y facebook con el mismo rechazo de permisos de Página. Es anterior a este despliegue y no se reintentó |

Esto no se atribuye al despliegue de Control ni se da por reparado. El webhook de Telegram y los workflows n8n no se modificaron. El problema TLS histórico de n8n tampoco se tocó.

## Capturas

Sin datos de clientes: `docs/auditoria-homestead-app/evidence/control-live-login.png` y `control-live-offline.png`.

## Registros sintéticos

Ninguno en producción. Las sesiones de prueba de login se revocaron al cerrar sesión.

## Limitaciones

- Video, Reels y carrusel siguen fuera de esta entrega. La interfaz lo dice.
- Escribir contenido de prueba en producción puede publicarse porque el estudio no está en dry-run y el scheduler no excluye esos registros.
- Métricas de alcance de Meta siguen «no disponibles».
- Instalación PWA en un teléfono físico no se hizo aquí.

## Reversión

1. No restaurar el SQLite viejo: las migraciones son aditivas y la base actual sigue siendo la de negocio.
2. `docker tag homestead-homestead_web:pre-control-20261002-212845 homestead-homestead_web:latest`
3. En `/opt/apps/homestead/deploy/vps`: `docker compose --project-name homestead up -d --no-deps --force-recreate homestead_web`
4. Conservar `/opt/apps/homestead/data` y el `.env`.
5. El respaldo utilizable está en `/opt/backups/homestead-pre-control-20261002-212845`.

## Paso que falta en Meta

En el administrador de la app de Homestead, genera un token de Página para `1390930010760052` que Graph acepte en lectura de esa página y de la cuenta de Instagram vinculada. El error actual pide al menos un permiso de página de la lista de arriba. Para el publicador ya implementado también hacen falta `pages_manage_posts`, `instagram_basic` e `instagram_content_publish`. No pegues el token en el chat. Sustitúyelo en el VPS con `deploy/vps/set-meta-page-token.sh --replace` y recrea solo `homestead_web`. Después se puede comprobar de nuevo la lectura. Publicar una pieza real sigue siendo una decisión aparte.
