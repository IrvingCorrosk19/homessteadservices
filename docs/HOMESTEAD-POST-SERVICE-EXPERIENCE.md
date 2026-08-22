# Experiencia post-servicio

Objetivo: agradecer, confirmar que todo quedó bien, detectar un problema y pedir reseña **solo** cuando la experiencia fue positiva. Sin acoso. Sin reseñas manipuladas.

## Canal

Automatización al cliente = **email transaccional** (SMTP ya usado por Homestead).

No hay WhatsApp Business API. El enlace `wa.me` es para el admin. Telegram es el command center interno, no el canal del cliente.

Una solicitud de servicio no es permiso de marketing. `marketing_opt_in` existe y por defecto es 0.

Si el cliente tiene `do_not_contact`, el follow-up se marca `SKIPPED`.

## Secuencia

```
COMPLETED
 → outbox job.completed
 → outbox post_service.followup_due (delay configurable)
 → email + link /experiencia/<token>
 → respuesta
      ├─ Excelente / Bien → oportunidad de reseña si hay URL
      └─ Necesito ayuda → service recovery, SIN reseña
```

Delay: `POST_SERVICE_FOLLOWUP_DELAY_MINUTES` (producción 120). En pruebas se puede bajar.

## Página de satisfacción

- Token aleatorio de 32 bytes (64 hex). No es el `HJ-*`.
- Expira (`SATISFACTION_TOKEN_TTL_HOURS`, 168).
- Un propósito. Sin sesión admin.
- Primera respuesta gana. Un segundo toque no cambia el resultado ni dispara otra reseña ni otra alerta.

## Recuperación de servicio

Feedback negativo o “necesito ayuda”:

- `recovery_status=OPEN`
- evento `customer.service_recovery:<jobId>:<cycle>`
- alerta Telegram `🚨 CLIENTE NECESITA ATENCIÓN`
- prioridad sobre marketing

Marcar **Atendido** deja auditoría `SERVICE_RECOVERY_CONTACTED`. No se reenvía la alerta al abrir la ficha.

## Reseñas

`HOMESTEAD_REVIEW_URL` debe ser `https://...`. Si no está configurada, **no hay botón**. Homestead no inventa perfiles.

No se pide “solo si fueron 5 estrellas”.

Se persiste `review_requested_at` y, si el cliente abre el puente `/experiencia/<token>/resena`, `review_link_opened_at`.

No se afirma `review_completed`. Homestead no confirma la reseña en Google.

Recordatorio opcional: `HOMESTEAD_REVIEW_REMINDER_HOURS` (default 0 = no spam). Máximo uno.

## Fallos

| Falla | Trabajo | Follow-up |
| --- | --- | --- |
| n8n/Telegram caído | COMPLETED se conserva | outbox PENDING/RETRY |
| Email caído | COMPLETED se conserva | FAILED + retry. No se miente que se envió |
| Sin email del cliente | COMPLETED | SKIPPED `no_email` |
