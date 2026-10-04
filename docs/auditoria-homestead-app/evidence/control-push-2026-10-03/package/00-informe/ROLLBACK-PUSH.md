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

## Rollback de despliegue (caso normal)

**Solo revertir código/imagen.** Conservar la base SQLite viva actual.

1. Volver a la imagen taggeada previa (`ROLLBACK_IMAGE` del script `deploy-control-vps.sh`) o al commit anterior.
2. Recrear `homestead_web` apuntando al mismo volumen `/opt/apps/homestead/data`.
3. Si el código anterior no conoce tablas `control_push_*`, dejarlas en la DB (aditivas) y mantener `CONTROL_PUSH_ENABLED=false` hasta alinear.
4. **No** restaurar un backup de SQLite como paso de rollback de código.

## Qué NO hacer

- **Prohibido como rollback normal:** restaurar `BACKUP_DIR` / un backup pre-deploy **encima** de la DB de producción. Eso puede borrar solicitudes, citas, piezas, publicaciones y registros push creados **después** del stamp del backup.
- Los datos de push nuevos viven en el volumen `data/` actual; restaurar un backup antiguo los pierde junto con el resto de la operación posterior.

## Recuperación con backup (solo incidente de corrupción)

1. Decisión explícita de ops: corrupción o pérdida estructural demostrada.
2. Restaurar el backup a una ruta **paralela** (nunca cortar tráfico primero sobre la viva).
3. Inventariar filas creadas después del stamp del backup y fusionarlas / reinyectarlas antes de cortar tráfico.
4. Solo entonces considerar cutover.
