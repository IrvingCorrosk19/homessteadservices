# Motor de campañas Homestead — informe de implementación

Fecha: 21–22 de septiembre de 2026 (America/Panama).  
Modo de publicación durante este trabajo: **simulación** (`CONTENT_DRY_RUN=true`, `CONTENT_MODE=ASSISTED`). No se publicó nada en Facebook ni Instagram.

Este informe distingue estado, no intención.

| Estado | Significado |
| --- | --- |
| **Implementado** | Código en el repositorio, listo para correr con el Content Studio existente. |
| **Desplegado** | Corre en el VPS / n8n de producción. |
| **Probado con ejecución real** | Se ejecutó (SQLite, Sharp, planificador, aprobación, atribución) en una base aislada. |
| **Probado mediante simulación** | El flujo de programación y publicación se verificó en dry-run, sin Graph. |
| **Bloqueado por dependencia externa** | Falta Meta, créditos OpenAI, recepción de WhatsApp u otra cuenta. |
| **Pendiente** | Trabajo consciente que no se hizo en esta fase. |

---

## 1. Motor implementado

Arquitectura intacta:

- **Homestead** decide campañas, piezas, copy, imágenes, aprobación, atribución, métricas propias y publicación.
- **n8n** sigue siendo disparador (scheduler 10 min, weekly, analytics). No se duplicó el publicador.
- **Telegram** opera, revisa y reporta.

### Implementado

- Ficha de marca (`src/lib/campaign-brand.ts`) con datos **confirmados / pendientes**. No inventa precios, garantías, testimonios, 24/7 ni zonas no configuradas.
- Objeto de campaña y piezas (`campaigns`, `campaign_pieces`, experimentos, clics, eventos).
- Planificador que respeta `max_posts_per_day=1` y `min_hours_between_posts=36` en ventanas 18:00–20:00 America/Panama, lun–sáb.
- Piloto de **cerrajería digital**: 5 piezas de foto distintas + 1 guion de reel (`SCRIPT_READY`, no publicable como video).
- Composición visual sobre `public/images/services/locksmith.webp` (foto **ilustrativa**, barra «IMAGEN ILUSTRATIVA · NO ES UN TRABAJO DOCUMENTADO»). Presupuesto de generación AI de la campaña = **0**. No se llama a OpenAI.
- Operación por Telegram: crear, calendario, piezas, enfoque, editar, recomponer foto, aprobar campaña/pieza, programar (al aprobar), pausar, cancelar, resultados.
- Aprobación conjunta = lista exacta de `pieza + versión`. Si una pieza cambia, se invalida la aprobación.
- Pausa: el scheduler no publica piezas de esa campaña. Cancelación: no borra historial ni lo ya simulado/publicado.
- Atribución web: `utm_*` + `hs_ref` en `/contact` y formulario; se guarda en la solicitud. Las solicitudes **sin** referencia siguen funcionando.
- WhatsApp oficial `50766616580` con mensaje prellenado y referencia interna. Un clic **no** es conversación ni solicitud.
- Instagram: el caption no se trata como enlace clicable. Conversión viable: enlace del perfil hacia homestead.lat / formulario, o WhatsApp. Sin atribución por pieza si solo se vio el post.
- Redirección medible `/api/r/CM-… .CP-… .web|wa|ig|fb` (clic ≠ lead).
- Embudo reutilizado: NEW, CONTACTED, cotización (`revenue_quotes`), cita (`revenue_appointments`), trabajo (`revenue_jobs`), COMPLETED, CANCELLED. Nadie se marca contratado por un formulario o un clic.
- Reporte semanal Homestead enriquecido (`campaignWeeklyBlock`). Las pruebas `is_test=1` no entran en indicadores comerciales.
- Carrusel: **no publicable**. El publicador actual acepta una sola foto. Quedó documentado en el resumen de campaña.
- Reels: modelo + guion + lista de tomas. Estados separados: guion preparado / video generado / video publicable. Solo existe el primero.

### Desplegado

- **Pendiente de este ciclo.** El código está en el repo; el contenedor `homestead_web` del VPS no se actualizó en esta pasada. Hasta el deploy, Telegram de producción no crea campañas `CM-`.
- n8n: **no se duplicaron crons**. El weekly existente ya pega a Homestead; Homestead ahora incluye el bloque de campañas cuando el código nuevo esté en el VPS. No hizo falta un workflow nuevo.

### Probado con ejecución real (base aislada)

Script: `node scripts/test-campaign-engine.mjs` (incluye `scripts/campaign-engine-behavior.ts`).

Resultado: **CAMPAIGN ENGINE TESTS PASS**.

Se ejecutó de verdad:

- Plan de 5 huecos a partir de un pedido de 7 días (quedó **estirado** y el texto lo explica).
- Alta de campaña `CM-2026-000001` con piezas `CP-2026-000001` … `000005` + guion reel, jobs `HC-`, JPEG compuestos con Sharp.
- Aprobación conjunta v1.
- Edición posterior → v2 e invalidación.
- Rechazo de copy con garantía/24/7.
- Tope de generación AI = 0.
- Pausa (scheduler no toma esas piezas).
- Clic de prueba excluido del conteo comercial.
- Solicitud de prueba con origen de campaña (`is_test=1`) excluida del reporte vivo.
- Solicitud **sin** UTM (plomería) creada igual.
- Cancelación sin borrar el registro de la campaña.

En esa corrida el piloto se canceló a propósito (prueba de cancelación). En Telegram de un entorno desplegado hay que **volver a pedir** la campaña para dejarla en revisión.

### Probado mediante simulación

- Programación: al aprobar, los jobs pasan a `SCHEDULED` con `CONTENT_DRY_RUN=true`. El publicador existente las marcaría `SIMULATED` si el scheduler las tomara. No se llamó a Graph.
- Informe de campaña: alcance/reproducciones Meta = **no disponible** (no se fabricó un cero).

### Bloqueado por dependencia externa

| Dependencia | Efecto |
| --- | --- |
| Cuentas Meta / Graph | No hay alcance, reproducciones ni publicación real. |
| Créditos OpenAI | No hay imagen AI nueva. El piloto usa la foto ilustrativa de cerrajería. |
| Recepción de WhatsApp | Homestead no ve el hilo. El clic a `wa.me` no cuenta como conversación. Atribución manual posible. |
| Enlace del perfil de Instagram | Una sola URL de bio; no se cambió sola. El caption no es clicable. |
| Horario y zona en env | Si `NEXT_PUBLIC_HOURS` / `NEXT_PUBLIC_SERVICE_AREA` no están, no se anuncian. Se usa «Panamá» como mercado del sitio, marcado pendiente de barrios. |
| Testimonios y fotos de trabajos reales | `works.enabled=false`, `testimonials.enabled=false`. Prohibido presentar stock o IA como instalación hecha. |

### Pendiente

- Deploy al VPS con backup de SQLite y `CONTENT_DRY_RUN=true`.
- Revisar el piloto en Telegram y, solo entonces, decidir publicación real pieza a pieza (`/live` / `live_once`, no apagar el dry-run global).
- Precios, garantías, cupos y testimonios cuando existan datos autorizados.
- Soporte de carrusel y de video publicable (hace falta el publicador, no un prompt).
- Conectar insights de Meta cuando las cuentas existan.
- Autorizar un presupuesto de generación > 0 si se quieren imágenes AI.

---

## 2. Campaña piloto (cerrajería digital)

**Objetivo comercial:** solicitudes calificadas de evaluación / instalación de cerradura digital.

**Público:** propietario o residente que quiere instalar una cerradura digital. No se usaron perfiles sensibles.

**Cobertura:** la configurada en el sitio; si el env de zona no está, el texto habla de Panamá y deja barrios como pendiente interno.

**Pedido de 7 días vs límites vigentes:** 1 publicación/día y 36 h de separación, lun–sáb, 18:00–20:00. Cinco piezas no caben en 7 días. El motor **reprograma** (típicamente ~9–11 días) y lo explica en `schedule_note`.

**Cinco enfoques (foto, publicables):**

1. Identificación — buscar la llave al llegar (comodidad).
2. Explicación — ¿sirve mi puerta? Tres fotos del formulario real.
3. Confianza — proceso publicado: Cuéntanos → Coordinamos → Atendemos → Listo.
4. Objeción — no se instala a ciegas; sin precio ni marca en el anuncio.
5. Solicitud — un CTA, sin escasez falsa.

**Reel:** guion 15–20 s y tomas pendientes de grabar. No es video generado ni publicable.

**CTA y destinos:** formulario `/contact?service=locksmith&intent=digital_lock_purchase_install` con UTM + `hs_ref`. WhatsApp oficial con texto natural y folio. Instagram: «enlace en el perfil».

**Presupuesto de generación:** 0. Vistas previas = composición sobre la foto ilustrativa existente.

**Hipótesis abierta (no hay ganador):** comodidad frente a control de acceso. Comparar posts orgánicos en horarios distintos **no** es un experimento aleatorio. Con pocos datos el reporte dice evidencia insuficiente.

**Solicitud de prueba:** mensaje `CAMPAIGN-ENGINE-TEST`, `hs_test=1`, teléfono de prueba. Queda fuera de indicadores reales. No se despacha correo ni n8n en ese caso.

---

## 3. Qué puedes hacer desde Telegram (cuando el código esté en el VPS)

El bot de Content Studio, en chat privado, con permiso `content.read` (aprobar exige `content.approve`).

| Qué escribes | Qué ocurre |
| --- | --- |
| `Prepara una campaña de cerrajería digital para siete días. Quiero solicitudes de instalación.` | Crea (o reusa) la campaña piloto, arma 5 piezas + guion, envía resumen, fotos y calendario **sin publicar**. |
| `/campana` | Ayuda breve. |
| `/calendario` o `/calendario CM-2026-000001` | Fechas en la cadencia real, con la nota si se estiró el horizonte. |
| `/piezas` | Lista y vuelve a mandar vistas previas. |
| `cambia el enfoque a control de acceso` | Ajusta la hipótesis de la primera pieza, **invalida aprobación**, no cambia precios ni zonas. |
| `edita CP-2026-000001: …texto…` | Nueva versión. Si el texto tiene claims sin confirmar, se rechaza. |
| `recompón foto CP-2026-000001` | Nueva composición sobre la foto ilustrativa, sin OpenAI. Hay que aprobar de nuevo. |
| `/aprobar_campana` o botón **APROBAR CAMPAÑA** | Aprueba **exactamente** esas versiones y las deja `SCHEDULED`. Con dry-run, el scheduler las **simula**, no las sube a Meta. |
| Botón **APROBAR PIEZA** | Igual, una sola pieza. |
| `/pausar_campana` | No salen piezas nuevas de esa campaña. Lo ya publicado o simulado se queda. |
| `/cancelar_campana` | Las pendientes no salen. El historial y lo ya hecho se conservan. |
| `/resultados` | Números Homestead (solicitudes, citas, etc.) y Meta como no disponible. Pruebas excluidas. |

Antes de aprobar verás: objetivo, piezas, plataformas, fechas, pendientes internos, costo de generación (0), y si el modo es simulación o real.

Una pieza de un solo post (`Crea una publicidad de cerrajería`) sigue yendo al flujo AI de una pieza, no a este motor de campaña.

---

## 4. Datos de marca que el motor se niega a inventar

Confirmado en código/sitio: nombre Homestead Services, logo, colores, tono, servicios de i18n (cerrajería, plomería, pintura, remodelación, mantenimiento/reparaciones, aires), proceso de 4 pasos, WhatsApp `+507 6661-6580`, formulario de instalación de cerradura digital.

Pendiente: catálogo de precios, garantías, testimonios autorizados, años de experiencia, cupos, barrios exactos si el env no está, fotos de trabajos propios.

Si el copy intenta 24/7, precio, garantía, testimonio, superlativos, cupos falsos o “esta foto es un trabajo nuestro”, **no se aprueba**.

---

## 5. n8n y costos

- Scheduler existente: ahora **omite** jobs cuya campaña está pausada/cancelada o cuya versión ya no es la aprobada.
- Weekly existente: Homestead añade el bloque de campañas al texto que ya manda por Telegram. n8n no genera un segundo reporte.
- No se activó generación recurrente ilimitada.
- No se disparó publicación real.

---

## 6. Cómo verificar en un entorno desplegado

1. Confirmar `CONTENT_DRY_RUN=true`.
2. En Telegram: la frase de los 7 días.
3. Revisar las 5 imágenes (texto legible, logo, «ilustrativa», un mensaje).
4. Aprobar la campaña. Comprobar folios y versiones.
5. Editar una pieza y ver que el botón viejo ya no vale.
6. Pausar / cancelar.
7. Abrir el enlace web con UTM, enviar una solicitud de prueba `CAMPAIGN-ENGINE-TEST` y otra **sin** parámetros.
8. `/resultados`: la de prueba no infla el número comercial; Meta sigue no disponible.

No envíes mensajes a clientes ni uses el formulario público con datos reales de prueba.

Cuando el contenido, los destinos y el calendario simulado estén revisados, se puede hablar de publicación real **pieza a pieza**. Eso no forma parte de esta entrega.
