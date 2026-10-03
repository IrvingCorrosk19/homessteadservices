# 07 — Backlog y bloqueos

Fecha de corte: 2026-10-02 America/Panama. Fase de descubrimiento cerrada. La V1 local de Homestead Control está en `08-HOMESTEAD-CONTROL-V1.md`.

---

## 1. Qué construir primero (orden)

| # | Ítem | Por qué ahora | Dependencia |
| --- | --- | --- | --- |
| 1 | Cola web de contenido (solo lectura) | El bot no recibe updates; el negocio de publicación **sí** vive en SQLite | Ninguna de Telegram |
| 2 | Acciones web approve / schedule / reject / live confirm | Cierra “aprobé y no publicó” sin esperar TLS | Ítem 1 + mismas funciones TS |
| 3 | Intake web de N fotos → N HC- + HB- | Sustituye álbumes mientras el webhook esté caído | Ítem 1 |
| 4 | Vista de fallos Graph + jobs APPROVED atascados | HC-025…028, 047…051, 040 | Ítem 1 |
| 5 | Campañas web (CM-002) | Piezas en NEEDS_REVIEW | Ítem 2 |
| 6 | Mapear roles web = `telegram_operators` | Evitar un segundo IAM | Cuando haya más de un usuario web |

**No primero:** cotizaciones, jobs de campo, reseñas, Mini App, recolector Meta, carrusel, nativo, importar workflows revenue.

---

## 2. Trabajo operativo (no es la app; bloquea operación)

Estos **no** se hicieron en esta fase (límites: no tocar producción).

| Ítem | Evidencia | Estado | Pedido mínimo |
| --- | --- | --- | --- |
| Certificado TLS de `n8n.autonomousflow.lat` | `getWebhookInfo` → `SSL error … certificate verify failed` (~2026-10-01 13:31 Panama). 0 updates desde 24-sep. Content Studio 0 exec / 7 d | **BLOQUEADO** | Acceso a renovar cert Nginx de n8n (certbot). **No** pegar tokens en el chat. |
| Cron backup no ejecutable | `production-backup.sh` `-rw-rw-rw-`; log `Permission denied` cada 03:15; sin `/opt/backups/202610*` | **VERIFICADO** | `chmod +x` del script (fuera de esta fase) o systemd timer |
| `DEPLOYED_SHA` obsoleto | Archivo = commit 22-ago; contenedor 22-sep | **VERIFICADO** | Escribir SHA real en el próximo deploy |
| Permisos Page token | FAILED 24–30 sep `pages_*` | **PARCIAL** | Revisar scopes en Meta Business (UI), sin volcar el token |
| Jobs APPROVED atascados | HC-047…051, 054 | **VERIFICADO** datos | Decidir: pasar a SCHEDULED o cancelar. No auto-publicar desde aquí |
| Inconsistencia HC-040 | PUBLISHED en pubs, job NEEDS_REVIEW | **VERIFICADO** | Reconciliar estado (escritura: fase posterior) |

---

## 3. Bloqueos de esta auditoría (qué no se pudo)

| Área | Qué faltó | Dónde se buscó | Impacto en conclusiones |
| --- | --- | --- | --- |
| Login `/admin` | No se inició sesión (cookie/secreto) | Código de páginas sí | Admin web = **PARCIAL** en ejecución |
| UI n8n | No se abrió | Postgres `workflow_entity` completo | Suficiente para inventario |
| Graph live | No se llamó | `content_publications.error` + flags SET | Scopes **actuales** desconocidos |
| Inbound Telegram | SSL | `getWebhookInfo` + SQLite updates | Panel **no certificado hoy** |
| Logs contenedor | No volcados | — | Evitar PII; eventos SQLite bastan |
| Restore drill | No ejecutado | `/opt/backups/homestead-pre-*` | DR **NO ENCONTRADO** off-box |
| Variables n8n valores | Solo nombres | tabla `variables` | Correcto |
| Otras apps del VPS | No inspeccionadas | `docker ps` nombres | Solo se documenta n8n compartido |

Nada de lo anterior impide diseñar la app web contra el backend.

**No pedir al operador que pegue secretos, tokens ni dumps de clientes.**

Si hace falta un solo acceso para la siguiente fase de **operación** (no de diseño): renovación TLS de n8n por la persona que ya opera el VPS.

---

## 4. Backlog técnico derivado del inventario

| Ítem | Tipo | Notas |
| --- | --- | --- |
| Facade HTTP admin para `tryApproveContentJob` / `approvePhotoBatch` / `publishJob` / `approveCampaign` | Nuevo | Sin copiar reglas |
| Feature flag `ADMIN_CONTENT_UI` | Nuevo | Rollback |
| Transición APPROVED → SCHEDULED | Bug/producto | Hoy el tick ignora APPROVED |
| Reconciliar job status vs `content_publications` | Bug | HC-040 |
| Analytics collect real | Hueco | 13 ticks, `collected: 0` |
| Fallback tick (cron host) | Resiliencia | SPOF n8n |
| `automation_outbox_audit` vacío | Observabilidad | 0 filas |
| Worktree local sucio vs contenedor | Proceso | Commit/photo-batch no está en Git |
| Doc `HOMESTEAD-CONTENT-STUDIO.md` “V1 no publica” | Doc | Contradice runtime |
| 9TG / BrokerPro | Riesgo | Dejar inactivo |
| `/lead` no idempotente | Código | No exponer igual en web |
| Video / Reels / carrusel | Diferido | Publicador JPEG |

---

## 5. Criterio de cierre de *esta* fase

El operador puede responder:

| Pregunta | Respuesta corta |
| --- | --- |
| ¿Qué funciona? | Sitio, SQLite, tick n8n, outbox, publicación Meta ya ocurrida, admin de solicitudes/citas en código. |
| ¿Qué estaba planteado? | Quotes/jobs/reseñas, recolector Meta, daily n8n, carrusel, Wave D. |
| ¿Quién hace qué? | App = cerebro + SoT + Meta + SMTP + Bot salida. n8n = 2 webhooks + cron. Telegram = UI operador (caída inbound). |
| ¿Dónde viven los datos? | Un SQLite + dirs `data/*`. n8n Postgres solo de n8n. |
| ¿Problemas conocidos? | SSL webhook; approve≠publish (scopes + estado APPROVED); lotes parciales históricos; backup cron muerto. |
| ¿Cómo conectar la app? | Cliente del backend Homestead, mismas funciones, un bot, n8n intocado. |
| ¿Primero? | Cola y acciones de contenido en `/admin`. |
| ¿Accesos? | TLS n8n para devolver el bot; no se necesitan secretos en el chat. |

Esta carpeta **no** es una certificación de go-live ni de la app nueva.
