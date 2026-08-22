# Ciclo de trabajo Homestead

Homestead = fuente de verdad. n8n = orquestación. Telegram = command center. OpenAI = inteligencia solo cuando un humano pide procesar contenido. `automation_outbox` = entrega durable.

## Qué es un trabajo

Una **cita** (`HA-*`) es un servicio programado.

Un **trabajo** (`HJ-YYYY-NNNNNN`) es el servicio en ejecución o ya realizado.

No se marca un trabajo como completado porque pasó la hora de la cita.

La entidad real es `revenue_jobs`. Wave C no creó una tabla paralela.

## Identificador

- Interno y público: `HJ-YYYY-NNNNNN` (año en America/Panama, mismo contador `revenue_job_counters`).
- Relaciona, cuando existen: `customer_id`, `lead_id` (a menudo `HS-*`), `appointment_id` (`HA-*`).

## Estados

```
SCHEDULED → IN_PROGRESS → COMPLETED
              ↘ CANCELLED
              ↘ NO_SHOW
```

| Estado | Significado |
| --- | --- |
| SCHEDULED | Programado. Aún no se inició en campo. |
| IN_PROGRESS | En proceso. |
| COMPLETED | Realizado. `completed_at` + actor. |
| CANCELLED | Cancelado. |
| NO_SHOW | El cliente no se presentó. |

Completar está permitido desde `SCHEDULED` o `IN_PROGRESS` (un técnico puede cerrar sin haber pulsado Iniciar). No hay auto-complete por reloj.

## Appointment → Job

`ensureJobForAppointment` crea el `HJ-*` de forma perezosa al abrir Trabajos del día, o al iniciar desde Telegram/admin.

`PATCH /api/admin/appointments/:id` con `complete` **solo** cierra la cita. No completa el trabajo.

## Completar

Telegram y admin piden confirmación.

La transición es idempotente:

```sql
UPDATE revenue_jobs SET status='COMPLETED' ...
WHERE job_id=? AND status IN ('SCHEDULED','IN_PROGRESS')
```

Un solo evento `job.completed:<jobId>` en `automation_outbox`.

Auditoría: `JOB_CREATED`, `JOB_STARTED`, `JOB_COMPLETED`, `JOB_CANCELLED`, `JOB_NO_SHOW`.

## Mantenimiento (solo foundation)

Si `revenue-engine.json` tiene intervalo para el servicio (hoy: aire acondicionado = 90 días), al completar se guarda `recommended_next_service_at` y un registro `revenue_maintenance`.

**Wave C no envía recordatorios automáticos al cliente.**
