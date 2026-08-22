# Customer 360 Lite

No es un CRM. Es la ficha mínima para responder:

- ¿Cuántas solicitudes tuvo?
- ¿Cuántas citas?
- ¿Cuántos trabajos completados?
- ¿Cuándo fue el último servicio?
- ¿Qué servicios recibió?
- ¿Cuál fue la última satisfacción capturada?

## Dónde vive

`/admin/clientes/<customerId>`

El `customer_id` es el de `revenue_customers`. La ficha se abre desde un trabajo, no por búsqueda difusa de nombre.

## Identidad

No hay fusión automática por nombre.

Cuando hay que reconocer a alguien:

1. `customer_id` ya ligado al lead/trabajo
2. teléfono normalizado
3. email normalizado

Si el teléfono o el email coinciden con **más de un** cliente, no se fusiona.

## Conteos

Se leen de SQLite real:

- solicitudes: `service_requests` ligadas por `revenue_leads.customer_id`
- citas: `revenue_appointments.customer_id`
- trabajos completados: `revenue_jobs` en `COMPLETED`

`is_test=1` se muestra en la ficha para no tratar un canario como cliente real.
