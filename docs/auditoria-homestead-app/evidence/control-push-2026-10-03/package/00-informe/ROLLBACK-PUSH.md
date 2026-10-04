# Control Push — procedimiento de desactivación y rollback

## Desactivar push sin perder datos

1. En el `.env` del VPS (homestead_web):
   - `CONTROL_PUSH_ENABLED=false`
2. Recrear el contenedor `homestead_web` (mismo image/código).
3. Opcional: desactivar el workflow n8n **HOMESTEAD — Control Push FCM** (Active → off).
4. Tablas `control_push_devices`, `control_push_outbox`, `control_push_reminders` se conservan.
5. No borrar SQLite. No hace falta wipe de sesiones.

## Reactivar

1. `CONTROL_PUSH_ENABLED=true`
2. `CONTROL_PUSH_SUBJECT_ID`, `CONTROL_PUSH_ASSIGNEE_ALIASES`, `CONTROL_PUSH_REMINDER_OFFSET=30m`
3. `N8N_CONTROL_PUSH_WEBHOOK_URL` apuntando al webhook del workflow
4. Credencial Google (FCM) en n8n + `FCM_PROJECT_ID`
5. `google-services.json` real en el APK (nunca en Git)

## Rollback de despliegue

Usar la imagen taggeada en el backup previo (`ROLLBACK_IMAGE` del script deploy-control-vps.sh) y el directorio `BACKUP_DIR` de SQLite. Los datos de push nuevos no se pierden si se restaura el volumen `data/` completo.
