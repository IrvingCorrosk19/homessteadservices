# Multi-foto IG/FB — diagnóstico y corrección (2026-10-07)

## Causa demostrada

1. **Admin web** (`ControlIntakeForm`) subía varias fotos **sin** `publishMode=album`. El API (`intake/route.ts`) defaultaba a `separate` → N piezas HC- independientes, no un carrusel.
2. **Vista detalle admin** solo mostraba `previewAssetId` (primera foto). No había reordenar/quitar en web.
3. **Copy obsoleto** en `/admin/contenido/nuevo` decía que el carrusel no existía.
4. **Publicador** (`publishJob`): si `format`/`publishMode` no marcaban álbum, usaba solo `feeds[0]` aunque hubiera varias imágenes branded.
5. **Flutter** ya enviaba `publishMode=album` correctamente; el camino roto era principalmente admin + gate de publicación.
6. **Telegram** álbum → piezas separadas + mensaje `CAROUSEL_UNSUPPORTED` (por diseño; no tocado).
7. Graph API vigente (docs Meta / Instagram Content Publishing): children `is_carousel_item=true` → parent `media_type=CAROUSEL` → `media_publish`. Código usa `META_GRAPH_VERSION` default `v22.0`.

## Corrección (archivos)

- `src/components/admin/control/ControlIntakeForm.tsx` — modo álbum vs separado, orden, errores por foto
- `src/components/admin/control/ControlMediaEditor.tsx` — preview de todas las fotos, total, reordenar/quitar
- `src/app/admin/contenido/[publicId]/page.tsx` — usa el editor multi-foto
- `src/app/admin/contenido/nuevo/page.tsx` — copy actualizado
- `src/lib/content-publish.ts` — álbum si CAROUSEL/album/`feeds.length>=2`; dry-run no finge éxito con álbum inválido; causas con asset id
- `src/lib/content-multi-photo.ts` — `validateLivePublishImages` identifica asset fallido
- `scripts/test-multi-photo-album-e2e.mjs` — batería funcional [simulacion]

## Pruebas

Ver `results.txt` en este directorio. Suite `control-carousel-disposition-behavior.mjs`: PASS.

**Clase:** todas **[simulacion]** (Meta Graph simulado). **No** se publicaron posts reales en cuentas del negocio.

## Deploy

**Solo local.** No hay commit ni deploy a VPS en este ciclo. Producción sigue con el admin sin `publishMode=album` hasta desplegar estos cambios.

## Publicación real Meta

**No realizada.** No había contenido de negocio expresamente aprobado para publicar. Las 5 fotos de prueba quedaron en batería [simulacion] únicamente.
