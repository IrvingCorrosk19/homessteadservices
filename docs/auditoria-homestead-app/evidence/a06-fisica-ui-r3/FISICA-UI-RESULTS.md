# Fisica UI A06 r3

passed=10 failed=0
APK=versionName=1.1.8 / versionCode=10 minSdk=24 targetSdk=36
isolated=True
commit=2964773eb9784d62637067a0333de47c7c3a6a7f
dirty=True
album=HC-2026-000071
request=HS-2026-000004

## Criterios
- Persistencia real tras acciÃ³n UI
- API solo corrobora
- OCR para texto UI (dump Flutter vacÃ­o)
- Publicar = dry-run simulado ambas plataformas

- **PASS** Entorno: APK 1.1.8+10 + aislado + commit
- **PASS** Login UI muestra entorno aislado
- **PASS** Abrir album seed desde lista
- **PASS** UI A06: preview watermark contain + album reorder controls
- **PASS** Reordenar: orden distinto que persiste al salir y volver
- **PASS** Quitar: disminuye cantidad y la foto no reaparece en orden
- **PASS** Regenerar: resultado y revision actualizados
- **PASS** Publicar simulado: resultado final por ambas plataformas
- **PASS** Marcar seguridad: estado persistido al reabrir
- **PASS** Rechazar: guardar con motivo valido y estado persistido
