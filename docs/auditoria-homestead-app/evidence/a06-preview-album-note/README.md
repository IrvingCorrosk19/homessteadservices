# Evidencia A06 — preview exacta / álbum / contexto IA

Fecha: 2026-10-03 America/Panama. Dispositivo: Samsung A06 `R8YYA17KR3V`.

## Clasificación

| Tipo | Significado |
| --- | --- |
| **Prueba física (teléfono)** | APK aislado en A06 + `adb reverse` contra `127.0.0.1:3000`. |
| **API / simulación aislada** | `control:dev` (`HOMESTEAD_CONTROL_ISOLATED`). Graph Meta simulado. |
| **Pendiente Meta real** | No se publicó en redes ni se contactó clientes. |

## Entorno verificado

| Ítem | Valor |
| --- | --- |
| Backend | `npm run control:dev` → `data/control-dev` |
| APK instalado en A06 | `apps/homestead_control_mobile/dist/homestead-control-1.1.3+5-isolated-debug.apk` |
| versionName / versionCode | `1.1.3` / `5` |
| API_BASE | `http://127.0.0.1:3000` (banner `ENTORNO DE PRUEBA`) |
| adb | `reverse tcp:3000 tcp:3000` |

## Causas raíz

1. **Vista previa sin marca**  
   El asset `BRANDED` ya tenía recorte 1080×1350 + watermark (verificado por hash/archivo). Flutter usaba `BoxFit.cover` y recortaba la esquina SE donde vive la marca.  
   **Fix:** `BoxFit.contain`, PageView con contador, zoom, `Cache-Control: no-store` en media.

2. **Varias fotos → una publicación**  
   En producción desplegada (`35080a0`) **no** existía `publishMode=album` / `ingestControlAlbum` (solo brand-crop). El APK/prod anterior degradaba a piezas separadas o no ofrecía la modalidad.  
   **Fix (local/aislado):** intake álbum → un solo `HC-` `CAROUSEL` con `mediaOrderJson`; publisher IG carrusel / FB `attached_media`; error claro si alguna foto falla (`album_photo_not_ready`).

3. **Nota no orientaba el texto**  
   Se persistía en `job.description` pero `controlCopyFallback` la ignoraba. Control **no** hace visión de las fotos.  
   **Fix:** `controlCopyFromContext(note)`; UI «Contexto para la IA»; `regenerate_copy` / `save_copy` / `update_ai_context` invalidan aprobación. Editar contexto ofrece regenerar explícitamente.

## Piezas

| ID | Rol | Estado |
| --- | --- | --- |
| **HC-2026-000015** | Álbum 3 fotos **listo para revisión** + prueba Meta autorizada posterior | `AWAITING_APPROVAL` · assets finales `58,60,62` · original `57` |
| HC-2026-000009 | Álbum 3 fotos usado para publish **simulado** | `PUBLISHED` Graph sim (`example.invalid/sim`) · assets `35,37,39` |

## Evidencia visual (teléfono)

| Archivo | Qué demuestra |
| --- | --- |
| `phone/10-launch.png` | Banner aislado `127.0.0.1:3000` |
| `phone/21-preview-contain.png` / `30-pending-preview-wm.png` | Preview con marca visible + `1 / 3` + asset id |
| `phone/31-pending-slide2.png` / `32-pending-slide3.png` | Carrusel deslizable |
| `phone/33-pending-contexto.png` | Contexto IA + texto generado editable |
| `phone/34-pending-compare.png` | Comparar original vs final (ids distintos) |
| `media/original-34.jpg` vs `media/final-*-asset-*.jpg` | Archivos distintos; finales con marca |
| `media-pending/*` | Hashes de la pieza pendiente HC-000015 |
| `09-asset-correspondence.json` | Correspondencia approve→publisher sim |

## Qué falta desplegar

| Componente | Estado |
| --- | --- |
| Backend local aislado | Corregido y activo en este PC |
| Backend VPS `homestead.lat` | **Pendiente** commit/push + deploy (incluye álbum, copy-from-context, actions, watermark sRGB, media no-store) |
| APK producción (`API_BASE=https://homestead.lat`) | **Pendiente** build/firma e instalación; A06 hoy tiene APK **aislado** |
| Meta real IG/FB | **Pendiente autorización**; el texto ejemplo «Instalamos esta cerradura…» dispara claim `fake_job_photo` en prod (bloquea live; en aislado se omite el bloqueo) |

## No ejecutado

- Publicación real a Instagram/Facebook  
- Mensajes a clientes  
- Restaurar APK prod en el teléfono (sigue APK aislado 1.1.3+5 para inspección de HC-000015)
