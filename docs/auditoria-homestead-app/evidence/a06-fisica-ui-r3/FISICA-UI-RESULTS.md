# Fisica UI A06 r3b

passed=10 failed=1
APK=versionName=1.1.8 / versionCode=10 minSdk=24 targetSdk=36
isolated=True
commit=2a91b7ec85f30d8f45255e784d74bc0f87e68fe8
dirty=True
album=HC-2026-000083
request=HS-2026-000035
secReason=sec-fisica-r3b-eb7efafad8

## Criterios
- Persistencia real tras accion UI
- API solo corrobora
- OCR para texto UI (dump Flutter vacio)
- Publicar = transporte Meta simulado (dryRun=false + example.invalid; no Meta real)
- Seguridad: consulta previa != activacion; motivo unico + auditoria nueva

- **PASS** Entorno: APK 1.1.8+10 + aislado + commit
- **PASS** Login UI muestra entorno aislado
- **PASS** Abrir album seed desde lista
- **PASS** UI A06: preview watermark contain + album reorder controls
- **PASS** Reordenar: orden distinto que persiste al salir y volver
- **PASS** Quitar: disminuye cantidad y la foto no reaparece en orden
- **PASS** Regenerar: resultado y revision actualizados
- **PASS** Publicar simulado: resultado final por ambas plataformas
- **PASS** Seguridad: consulta previa sin marca
- **PASS** Marcar seguridad: activacion desde A06
- **FAIL** Rechazar: guardar con motivo valido y estado persistido
