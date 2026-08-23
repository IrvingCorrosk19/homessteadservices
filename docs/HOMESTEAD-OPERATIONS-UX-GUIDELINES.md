# HOMESTEAD — Operations UX Guidelines

Principio: **VER → ENTENDER → ACTUAR → CONFIRMAR → CONTINUAR**

## 1. Operations-first

- La primera pregunta de cada pantalla operativa: **¿qué necesita mi atención?**
- Dashboard: bloque **Necesita tu atención** antes de métricas de BI.
- Métricas decorativas no deben ocultar tareas accionables.

## 2. Immediate feedback

- Toda acción produce cambio visible en <300ms percibidos (optimistic UI o loading local).
- Prohibido: click → silencio → usuario busca qué pasó.
- Mensajes humanos: `✓ Solicitud atendida`, nunca `HTTP 200` / `Success`.

## 3. Context preservation

- Filtros operativos en URL (`ops=NEEDS_ATTENTION`).
- Scroll de lista en `sessionStorage` al abrir detalle.
- Detalle recibe `returnTo` para volver al mismo contexto.
- Calendario persiste `view`, `date`, `id` en URL.

## 4. Visual hierarchy (estados)

Usar **un solo sistema**: `src/lib/request-status-visual.ts`

Prioridad visual:

1. URGENTE (SLA escalado, solo NEW)
2. NECESITA ACCIÓN (NEW)
3. EN GESTIÓN (IN_PROGRESS)
4. ATENDIDA (CONTACTED — label “Atendida”)
5. CERRADA (COMPLETED / CANCELLED)

Nunca depender solo del color: badge + icono + texto + contraste + posición.

## 5. Primary action

| Pantalla | Primaria | Secundaria |
|----------|----------|------------|
| Solicitud NEW | Contactar | Marcar atendida |
| Solicitud detalle mobile | Contactar (sticky) | Atendida |
| Customer 360 | Contactar | Ver solicitudes / citas |
| Cita mobile | Detalle sheet → Reprogramar | Contactar |

## 6. Progressive disclosure

- Máximo 2 acciones visibles + menú **Más** en mobile nav.
- Acciones destructivas separadas visualmente y con confirmación.

## 7. Mobile

- Bottom nav: Inicio, Solicitudes, Citas, Clientes, Más.
- Bottom sheets para detalle de cita (no scroll para descubrir).
- Sticky action bars sobre bottom nav (`pb-24` layout).
- Targets mínimos 44px (`min-h-11`).

## 8. Search

- Ctrl+K / botón en top bar.
- Resultados agrupados: Cliente, Solicitud, Cita.
- Reutiliza `listCustomers`, `listServiceRequestsForOps`, SQLite appointments.

## 9. Empty states

- Específicos: “No tienes solicitudes pendientes”, no “No hay datos”.

## 10. Undo policy

- **Marcar atendida:** sin undo — compromete pipeline, Attention Center, `first_human_action_at`.
- **Reprogramar cita:** confirmación modal (riesgo operativo).
- **Reversible low-risk:** preferir acción inmediata + toast (sin modal genérico).

## 11. Terminology

| UI | DB / internal |
|----|----------------|
| Solicitud | service_requests |
| Atendida | CONTACTED |
| Pendiente | NEW |
| En gestión | IN_PROGRESS |
| Cita | revenue_appointments |

No mezclar Lead / Caso / Request en UI operativa.

## 12. No feature creep

- Mejorar flujos existentes.
- No nuevos módulos CRM, chatbot admin, ni motores de prioridad paralelos.
