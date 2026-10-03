# 13 — Homestead Control Flutter Android



Fecha: 2026-10-03 America/Panama (cierre etapa aislada + A06).



## Entrega



| Ítem | Valor |

| --- | --- |

| Carpeta | `apps/homestead_control_mobile` |

| applicationId | `lat.homestead.control` |

| versionName / versionCode | `1.1.0` / `2` |

| Android mínimo | API 24 |

| targetSdk | 36 |

| APK **producción** (instalado ahora en A06) | `apps/homestead_control_mobile/dist/homestead-control-1.1.0+2-debug.apk` |

| SHA-256 prod | `D677093C8E182E4968B0AF9DA1E70F7C925CB0A1DCE167081352C6CD33BED013` |

| API_BASE prod | `https://homestead.lat` |

| APK **aislado** (solo pruebas) | `…/homestead-control-1.1.0+2-isolated-debug.apk` |

| SHA-256 aislado | `8D92C37BB0D3A275180A58403A0FACF34B1D677B77F2AF46DB738DA59ECFFA1E` |

| API_BASE aislado | `http://127.0.0.1:3000` (+ `adb reverse`) |

| Firma | Debug keystore. **No** es firma de release Play |

| Teléfono | Samsung Galaxy A06 (`SM-A065M`, `R8YYA17KR3V`, Android 15) |



**Estado del teléfono al cerrar esta etapa:** APK de producción reinstado, `adb reverse` eliminado, login **sin** banner `ENTORNO DE PRUEBA` (evidencia `evidence/a06-isolated/99-restored-prod-login.png`).



## Qué se implementó



### Carruseles / multi-foto (motor compartido)



- 2+ fotos: elección **álbum** vs **una publicación por foto**.

- Álbum → `format=CAROUSEL`, `publish_mode=album`, orden `media_order_json`.

- Instagram: hijos `is_carousel_item` + padre `CAROUSEL` + `media_publish`.

- Facebook: fotos `published=false` + `/feed` `attached_media`.

- Reordenar/quitar: `POST …/jobs/:id/media` **invalida** `approved_version`.

- Fallos parciales / UNCERTAIN / retry: `publishJob` compartido (sin publicador paralelo).



### Rechazo / cancelación / info / reapertura



- `CANCELLED` + `disposition_kind` (`REJECT` | `CANCEL`).

- Nota interna privada + mensaje al cliente; outbox `service_request_notify_outbox` idempotente.

- Reapertura a `CONTACTED` sin recuperar cita.

- **Fix A06:** doble toque con misma `idempotencyKey` en reject/cancel ya dispuesto → `ok` + `already` (antes 409 `not_rejectable`).



### Revisión de seguridad



- Marca `security_review_required` + auditoría.

- Bloquea `createAppointment`, concierge auto-confirm, y **confirm/reschedule** de citas existentes (`PATCH /api/admin/appointments/:id` → 409).



### Aislamiento / simulación



- `control:dev` + `HOMESTEAD_CONTROL_ISOLATED`; Meta/SMTP/Telegram/n8n vacíos y simulados.

- Debug-only cleartext `127.0.0.1` en APK debug.

- Endpoint **solo aislado** `GET/POST /api/admin/control-dev/sim` (escenarios Graph + notify `fail_once`).



## Verificación



| Prueba | Tipo | Resultado |

| --- | --- | --- |

| `npx tsx scripts/control-carousel-disposition-behavior.mjs` | simulación in-process | PASS |

| `npx tsx scripts/test-homestead-control.mjs` | simulación in-process | PASS |

| `node scripts/control-physical-a06-matrix.mjs` | API aislada + simulación | **25/25 PASS** |

| `flutter analyze` | implementación | PASS |

| Instalación A06 aislada + banner `127.0.0.1:3000` | física | PASS |

| UI carrusel orden/quitar (HC-2026-000001) | física | PASS |

| UI notas internas / disposición / reopen forms | física | PASS |

| Security bloquea confirm/reschedule | API aislada | PASS |

| Cancel libera slot | API aislada | PASS |

| Doble toque / parcial FB / UNCERTAIN / notify retry / sesión revocada | API+sim | PASS |

| Publicación Meta real / email cliente real | real externa | **NO ejecutada** |

| Deploy VPS carrusel+disposición | producción | **PENDIENTE de aprobación** |



Evidencia: `docs/auditoria-homestead-app/evidence/a06-isolated/` (+ `README.md` con clasificación).



## Certificación



**No se declara certificación completa.** Cubierto: implementación + aislado (simulación + física A06). Pendiente para producción: commit/push autorizado, `deploy-control-vps.sh`, smoke admin/móvil en `homestead.lat`, y solo entonces pruebas reales externas si se autorizan.



## Plan de despliegue y reversión (para aprobar)

**Aún no desplegado.** No se restaura SQLite de producción sobre datos vivos salvo corrupción demostrada.

### Principio de reversión (obligatorio)

1. **Prioridad:** revertir **código** a imagen previa compatible con el esquema SQLite **ya migrado**.
2. **Prohibido como rollback normal:** restaurar el backup pre-deploy **encima** de la DB de producción si después del despliegue se crearon solicitudes, citas, piezas o publicaciones. Eso destruiría datos posteriores al respaldo.
3. Si una migración introdujo columnas/tablas nuevas, el código anterior debe **tolerar** el esquema ampliado o el rollback de código debe ir acompañado de un **bloqueo de operaciones incompatibles** (feature flags / pause publish / pause disposition) hasta alinear.
4. Restaurar DB desde backup solo ante corrupción o pérdida estructural, con procedimiento de **fusión** que preserve filas creadas post-despliegue (solicitudes `HS-*`, piezas `HC-*`, `content_publications`, outbox).

### Precondiciones

1. Commit/push del árbol local cuando lo autorices.
2. Ventana breve; no tocar n8n/Telegram/Meta tokens/.env salvo lo necesario para el build.
3. Confirmar en VPS: `HOMESTEAD_CONTROL_ISOLATED` **ausente**.

### Pasos propuestos (respaldo SQLite consistente)

```text
# En VPS (tras subir tarball/git del SHA aprobado):
/opt/apps/homestead/deploy/vps/deploy-control-vps.sh <SHA>
```

El script debe:

1. Etiquetar imagen Docker `homestead-homestead_web:pre-control-<stamp>`.
2. **Backup WAL-safe** (checkpoint + copia online o `sqlite3 .backup`) de `homestead.sqlite` + media → `/opt/backups/homestead-pre-control-<stamp>/` + `manifest.json` (SHA, tamaño, integridad).
3. Prueba de restore **aislada** en `/tmp/hs-restore-test-<stamp>` (nunca sobre la DB de producción).
4. Build/recreate solo `homestead_web`.
5. Health/ready 200; no apaga dry-run global ni force-live Meta.

### Verificación post-deploy

- `HOMESTEAD_CONTROL_ISOLATED` ausente; flags de publish intactos.
- Login admin + Bearer móvil.
- Smoke lectura: home contenido, una solicitud, una cita.
- **No** publicar en redes ni enviar mensajes a clientes reales en el smoke inicial.

### Rollback de código (caso normal)

```text
docker tag homestead-homestead_web:pre-control-<stamp> homestead-homestead_web:latest
# recreate solo homestead_web
```

Tras el recreate:

1. Verificar health/ready.
2. Si el código viejo no entiende columnas nuevas: **pausar estudio / no publicar / no disposición masiva** hasta hot-fix forward-compatible.
3. Inventariar objetos creados **después** del stamp de backup (`service_requests`, `content_jobs`, `content_publications`, `service_request_notify_outbox`) — deben seguir en la DB viva.

### Recuperación con backup (solo incidente)

1. No sobrescribir la DB viva a ciegas.
2. Restaurar backup a ruta paralela.
3. Exportar del vivo post-despliegue: solicitudes, piezas, publicaciones y outbox con `created_at` / ids posteriores al stamp.
4. Reinyectar en la DB restaurada (o fusionar) antes de cortar tráfico.
5. Documentar en el ticket los `public_id` preservados.

### Resultado concreto para tu aprobación

| Pregunta | Respuesta |
| --- | --- |
| ¿Se puede desplegar ya? | **Tras commit/push que autorices** y ventana con backup WAL-safe. |
| ¿Rollback pierde datos post-backup? | **No es aceptable.** Rollback = código (+ bloquear ops incompatibles). DB restore solo con fusión. |
| ¿Riesgo Meta al desplegar? | Solo si VPS ya tiene publish live; el deploy no force-live. Smoke en lectura. |
| ¿Qué apruebas? | `deploy-control-vps.sh <SHA>` con el plan de reversión anterior. |



## Limitaciones



- Video / Reels / Stories: no.

- Email cliente en prod depende de SMTP; fallo → outbox PENDING/FAILED con reintentos.

- WhatsApp al cliente: asistido (borrador), no API masiva.

- Telegram no crea álbumes automáticamente.

- APK firmado debug.



## Rama / commits



- Auth móvil previo: `545c6e7` (desplegado).

- Esta etapa: cambios locales (incl. fix doble-toque + `control-dev/sim`). Crear commit/push cuando se autorice.


