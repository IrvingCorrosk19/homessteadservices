# Implementación — publicación Homestead en Instagram y Facebook

**Actualizado:** 2026-09-21 22:05 America/Panama  
**No se publicó nada en Facebook ni Instagram.**  
**Publicador:** solo Homestead. n8n no crea posts.

---

## Estado por capa (esta entrega)

### Implementado en código

- Instagram: contenedor con `image_url` HTTPS firmada, poll de `status_code`, `media_publish`.
- Facebook Page Photos: `POST /{page-id}/photos`. Resultados independientes por red.
- URL `/api/content/media` HMAC, TTL 45 min, sin listar directorio ni tokens Meta.
- Aprobación versionada; botones viejos no publican otra V.
- `live_once` solo autoriza `source === "live"`. PUBLICAR AHORA y el scheduler siguen en simulación si `CONTENT_DRY_RUN=true`.
- Tras un intento live, `live_once` vuelve a 0. `/pausa` pone `live_once=0` en todos los jobs y bloquea también esas piezas.
- `CONTENT_PUBLISH_ENABLED=false` es kill switch extra.
- Reconciliación Facebook: solo `GET` de un post id ya guardado. **No** se asocia otro post por el mismo caption.
- n8n scheduler/analytics/weekly: `continueOnFail` + nodo Code `homesteadOk` + IF + aviso Telegram. Sin nodo Graph.

### Desplegado en Homestead

- Contenedor `homestead_web` recreado (imagen `4e4bfaf1d4e0…`), healthy, `https://homestead.lat/api/health` 200.
- Runtime: `CONTENT_DRY_RUN=true`, `CONTENT_MODE=ASSISTED`, `CONTENT_PUBLISH_ENABLED=true`.
- Backup previo: `/opt/backups/homestead-pre-content-meta-20260922-025630/homestead.sqlite` (integrity ok; 3 solicitudes, 2 citas). `.env` del VPS se conservó.
- Columnas `live_once`, `approved_version`, `permalink`, `container_id` presentes tras el primer `getHomesteadDb()`.
- `OPENAI_API_KEY=SET`. Token e IDs de Meta: **EMPTY**.

### Actualizado en n8n

Instancia `https://n8n.autonomousflow.lat` (n8n 2.3.6). IDs **conservados**, un flujo por nombre:

| Flujo | ID | Activo |
| --- | --- | --- |
| Content Scheduler | `nGiCm9Yt3PzPzDP9` | sí |
| Marketing Analytics Collector | `ZiQfUIPtEq3RsqVW` | sí |
| Weekly Marketing Report | `aSGBqm6D5SjSsYGL` | sí |
| Content Studio (sin cambio de grafo) | `x9PZMUr4NNvvlv8i` | sí |
| Nueva solicitud → Telegram | `i4t4Bw8JTQB8A2KE` | sí |

Backup: `/opt/backups/n8n/content-inplace-20260922-025946/` (export all + nodos previos). No se crearon duplicados.

Ejecución real del scheduler **después** del cambio: `success` a las 2026-09-21 22:00:10-05. Homestead respondió `ok: true`; la rama de aviso no debió dispararse.

### Verificado mediante ejecución real en simulación

| Prueba | Resultado |
| --- | --- |
| URL firmada desde fuera del contenedor (`https://homestead.lat/api/content/media`) | HTTP 200, JPEG, 285 bytes, `Content-Type: image/jpeg` (folio canario `HC-2026-000099`) |
| Firma inválida | HTTP 401 |
| URL caducada | HTTP 410 |
| Tick Homestead `scheduler-tick` | HTTP 200, `ok: true` |
| PUBLICAR AHORA v1 en `HC-2026-000099` | job `SIMULATED`; publicaciones `instagram` y `facebook` con `dry_run=1` e ids `dry-HC-2026-000099-*`. Log `ContentPublished stage=dry-run`. **No** hubo llamada Graph. |
| Botón `now:v9` (versión vieja) | HTTP 200; no cambió a publicado real; la simulación salió solo con v1 |
| `/pausa` con `live_once=1` | `paused=1` y `live_once=0`. `/reanudar` dejó `paused=0` |
| Entrada Telegram «Crea una publicidad de cerrajería» | Update 200, folio `HC-2026-000018` creado (`AI_CAMPAIGN`) |

**No aprobado el recorrido generación → preview → aprobación.** `HC-2026-000018` quedó `FAILED` / `image_generation_failed`. Log: OpenAI *no credits remaining*. No hubo `PreviewSent`.

### Pendiente exclusivamente de conexión con Meta

- `META_PAGE_ACCESS_TOKEN=EMPTY`
- `FACEBOOK_PAGE_ID=EMPTY`, `INSTAGRAM_ACCOUNT_ID=EMPTY`
- Inspección solo lectura `POST /api/internal/content/meta-status`: `tokenConfigured: false`, `page: null`, `instagram: null`, Graph `v22.0`. No se llamó a Graph (no hay token).

Pendiente **además** (no es Meta): créditos OpenAI para generar la imagen de campaña.

---

## Hallazgos corregidos en esta pasada

1. `live_once` persistente podía saltarse dry-run en PUBLICAR AHORA o el scheduler. Ahora solo `source=live`, se consume al usarse, y `/pausa` lo anula.
2. Reconciliar Facebook por caption era inseguro. Ahora solo se confirma un id ya almacenado.
3. Recuperación: dry-run **no basta** si `live_once=1`. Usar `/pausa` o `CONTENT_PUBLISH_ENABLED=false`. No restaurar todo el SQLite por un fallo de contenido.

---

## Pruebas locales (clasificación)

`scripts/test-content-publish-meta.mjs` — **estáticas** (grep de código + HMAC en proceso). PASS.

`scripts/test-content-publish-behavior.mjs` — **ejecutan política**: live_once vs now/scheduler, pausa, kill switch, éxito parcial IG/FB, lock concurrente, Facebook sin match por caption. No llaman Graph. PASS.

`npx next build` — PASS (local y en el build Docker del VPS).

No hay prueba automatizada que dispare Graph. Las de n8n `ok:false` en vivo: el detector `homesteadOk` se ejecutó en Python; el scheduler live solo se vio en `ok: true`.

---

## Qué debes hacer tú

### 1. OpenAI (para terminar el recorrido Telegram)

En [platform.openai.com](https://platform.openai.com/settings/organization/billing) añade créditos. En el chat **privado** del bot Homestead envía exactamente:

```
Crea una publicidad de cerrajería
```

Espera la imagen y el texto. Revisa. **PUBLICAR AHORA** = simulación. No pulses **PUBLICAR EN VIVO** hasta conectar Meta.

Si prefieres fotos de un trabajo real: `/publicar`, envía las fotos, **PROCESAR**.

### 2. Meta (cuando quieras el primer post real)

Mismos pasos que antes: Page + Instagram profesional, App Business, permisos oficiales, Page token, `FACEBOOK_PAGE_ID`, `INSTAGRAM_ACCOUNT_ID`, `META_PAGE_ACCESS_TOKEN` en `/opt/apps/homestead/deploy/vps/.env` (no en el chat). Recreate `homestead_web`. Inspección: `POST /api/internal/content/meta-status`.

Luego una sola pieza: `PUBLICAR EN VIVO ESTA PIEZA` → confirmar, o `/live HC-…`. Dry-run global **no** se apaga.

---

## Recuperación (corregida)

Backup de esta noche (copia consistente, no cortar el archivo a mano):

`/opt/backups/homestead-pre-content-meta-20260922-025630/homestead.sqlite`

n8n: `/opt/backups/n8n/content-inplace-20260922-025946/`

**Emergencia de publicación (sin restaurar la base):**

1. En Telegram: `/pausa` (anula `live_once` y bloquea cola y piezas sueltas).
2. O en `.env`: `CONTENT_PUBLISH_ENABLED=false` y recreate `homestead_web`.
3. Mantén `CONTENT_DRY_RUN=true`. Eso **no** detiene un `live_once` ya autorizado; por eso existe `/pausa`.

**No** sustituyas todo `homestead.sqlite` por un fallo de un post. Perderías solicitudes y citas posteriores al backup. Si hace falta deshacer solo contenido:

- Tablas `content_*` (jobs, assets, versions, publications) desde el backup, o borrar el folio canario.
- Dejar intactas `service_requests`, `revenue_appointments`, operadores, etc.

Rollback de código: imagen Docker anterior + el `.env` conservado. Los originales de fotos siguen en `/opt/apps/homestead/data/content/`.

---

## Próximos pasos (fuera de esta fase)

Reels, calendario automático de campañas, atribución de consultas al folio `HC-…`.

---

## Evidencia (sin secretos)

| Hecho | Evidencia |
| --- | --- |
| Deploy | `DEPLOY_OK`, backup `homestead-pre-content-meta-20260922-025630`, health 200 |
| Dry-run | `CONTENT_DRY_RUN=true` `CONTENT_MODE=ASSISTED` |
| Media pública | 200 / 401 / 410 en homestead.lat |
| Simulación IG+FB | `HC-2026-000099` SIMULATED, `dry-HC-2026-000099-instagram/facebook` |
| Pausa vs live_once | before 1 → after pause 0 |
| Telegram hasta OpenAI | `HC-2026-000018` FAILED `image_generation_failed` / no credits |
| n8n IDs | 5 flujos Homestead, mismos IDs, scheduler success 22:00:10-05 |
| Meta | `tokenConfigured: false`, IDs EMPTY |
| Graph / posts reales | ninguno |
