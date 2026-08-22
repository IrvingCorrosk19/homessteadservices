# Job → Content Studio

Mismo bot. Mismo webhook. Mismo Content Studio. Cero workflows n8n nuevos. Cero publicación automática a Meta en Wave C.

## Fotos del trabajo ≠ fotos del cliente

| Origen | Ruta |
| --- | --- |
| Cliente en la solicitud | `DATA_DIR/photos/...` |
| Trabajo realizado (Telegram admin) | `DATA_DIR/jobs/YYYY/MM/HJ-.../originals/original-NNN.ext` |
| Content Studio | `DATA_DIR/content/.../originals` (copia, nunca sustituye el original del trabajo) |

Los originales del trabajo no se sobrescriben. Un SHA-256 repetido se trata como duplicado.

## Consentimiento de marketing

Homestead **no** recoge hoy una autorización del cliente para publicar fotos.

Por eso `marketing_usage_approved` nace en 0.

Un administrador debe pulsar **Autorizar fotos** antes de crear contenido. Sin eso, Content Studio no llama a OpenAI (`processContentJob` falla cerrado).

Autorizar fotos no publica nada.

## Flujo

1. Trabajo `COMPLETED` con fotos.
2. Telegram pregunta al admin: ¿crear contenido?
3. Admin autoriza uso de fotos (si aún no).
4. **Crear contenido** copia originales al Content Studio existente (`HC-*`), deja el job en `RECEIVING`, y **no** llama a OpenAI.
5. Admin pulsa PROCESAR (pipeline actual: original → process → preview).
6. Preview + copy. Aprobar deja el contenido READY/APPROVED.
7. Wave C termina ahí. No hay auto-publish a Instagram/Facebook.

Copy: problema → solución → resultado → CTA. Se sanitiza teléfono, email, IDs y número de casa/apartamento. No se manda el nombre del cliente a OpenAI.

Before/after solo si las fotos del trabajo tienen rol explícito `BEFORE` y `AFTER`. No se inventa.

## Atribución

`content_jobs.source_job_id` → `HJ-*` → solicitud/cliente, sin PII pública.
