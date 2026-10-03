# 10 — Homestead Control: preparación de release

Fecha: 2026-10-02 America/Panama. Trabajo local previo al despliegue en `https://homestead.lat`.

## Estado

| Fase | Estado |
| --- | --- |
| Sesión revocable en servidor | Listo (`admin_sessions` + `isActiveAdminSession`) |
| Concurrencia web / Telegram / scheduler | Listo (`tryApproveContentJob`, `beginPublishLock`, claim de intake, `approve_and_schedule` idempotente) |
| PWA acotada a `/admin` | Listo (manifest, SW, offline genérico) |
| Pruebas aisladas CTL-01…44 | PASS en `data/control-test` |
| Pruebas HTTP-01…14 + 11b | PASS contra `http://127.0.0.1:3000` (control:dev aislado) |
| Desplegado | Pendiente de este ciclo (ver informe 11) |

## Paridad Telegram / Control web

Ambos llaman a los mismos servicios: `tryApproveContentJob`, `scheduleJob` / `assignStaggeredSlots`, `publishJob`, `setContentPaused`, `pauseCampaign` / `resumeCampaign`. Control no copia el motor de publicación.

Videos, Reels y carruseles siguen fuera de alcance. La carga web lo indica.

## Lo que no se prueba en producción con escritura

`is_test` no excluye `content_jobs` del scheduler ni de Meta. Las pruebas de escritura de contenido se hacen solo aisladas. En el dominio real: lectura, navegación y autenticación.

## Commit

El SHA de release se registra en `11-HOMESTEAD-CONTROL-DESPLIEGUE-VPS.md` después del push y el despliegue.
