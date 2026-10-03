# Homestead Control — estabilización (A06 aislado)

Fecha: 2026-10-03 America/Panama. Dispositivo: `R8YYA17KR3V` (SM-A065M).

## Comprobado primero (sin asumir)

| Problema reportado | Estado real en A06 aislado (APK ≥ 1.1.3+5) | Evidencia |
| --- | --- | --- |
| Vista previa ≠ publicada (sin marca) | **Corregido y verificado** — preview `BoxFit.contain`, marca visible, `1/3`, asset final | `phone/01-preview-watermark.png`, `05-preview-after-stabilize.png` |
| Varias fotos → una publicación | **Corregido y verificado** — `HC-2026-000015` `CAROUSEL` / `publishMode=album`, 3 assets | `01-hc015-status.json` |
| Contexto para la IA | **Corregido y verificado** — campo + texto generado desde contexto; sin visión de fotos | `phone/03-contexto-ia.png` |

Pieza de revisión (sin publicar): **`HC-2026-000015`**.

## Correcciones de fricción (esta pasada)

| Observado | Cambio | Prueba |
| --- | --- | --- |
| Mensaje de éxito decía «abre cada pieza» también en álbum | Mensaje distinto álbum vs separado; no asume éxito si el álbum no es 1 pieza | Código + rebuild 1.1.4+6 |
| Refresh en detalle saltaba siempre a foto 1 | Conserva índice del carrusel si los assets siguen | Código |
| Doble toque en «Subir y generar» | Guard `_busy` al inicio de `_upload` | Código |
| Timeout en acción no aclaraba «no reintentar a ciegas» | Snackbar explícito en timeout de detalle | Código |
| Volver de segundo plano sin revalidar sesión/red | `ShellScreen` + `resumeFromBackground()` | Código |

## Gap APK ↔ backend desplegado

| Capacidad | APK aislado local | Backend `homestead.lat` (`35080a0`) |
| --- | --- | --- |
| Marca 1080×1350 | Sí (con backend aislado) | Sí (brand-crop desplegado) |
| `publishMode=album` / carrusel | Sí contra `control:dev` | **No** en prod — intake/prod sin álbum; APK álbum contra prod degradaría a pieza(s) separadas |
| Contexto IA → copy | Sí contra aislado | **Pendiente deploy** del wiring `controlCopyFromContext` |
| Actions `regenerate_copy` / `save_copy` | Sí aislado | **Pendiente deploy** |

**Conclusión:** no usar APK con álbum/contexto nuevo contra `homestead.lat` hasta desplegar el backend WIP. El A06 de prueba usa `http://127.0.0.1:3000` + `adb reverse`.

## APK instalado en esta etapa

- `apps/homestead_control_mobile/dist/homestead-control-1.1.4+6-isolated-debug.apk`
- `versionName=1.1.4` / `versionCode=6`
- `API_BASE=http://127.0.0.1:3000`

## No ejecutado

- Publicación Meta real / mensajes a clientes
- Deploy VPS
- APK producción

## Pendiente (no bloquea lo comprobado)

- Desplegar backend álbum + contexto IA a VPS
- APK prod firmado apuntando a `https://homestead.lat`
- Completar/validar branding launcher (iconos generados en WIP; no es el foco de esta estabilización)
- Agenda: mejora de calendario en WIP sobre pestaña existente; no era el fallo P0 de esta pasada
