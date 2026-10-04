# Contact form UX — 2026-10-04

Listo para revisión en **aislado**. **No desplegado.**

## Formulario
- Ayuda permanente + ejemplo por servicio + mínimo **8** (alineado backend).
- Calidad: rechaza repetición tipo `wwwwwwww`; acepta tipografía imperfecta.
- Errores por campo, banner al enviar, foco al primero inválido.
- Loading real: Enviando / Subiendo fotos / Revisando; `aria-busy` / `aria-live`; hint si tarda.
- Confirmación con folio real + copiar; sin “Visita confirmada”.
- UI: `ui/desktop-*.png`, `ui/mobile-*.png` (validación + listo).

## Persistencia
- Folio aislado: `HS-2026-000065`
- Idempotencia `clientSubmissionId`: reintento → mismo folio.
- Detalle: `isolated/RESULTS.json`

## Push
- Evento único `control.push.new_request` para `HS-2026-000066`
- Clave: `control.push.new_request:HS-2026-000066:op:2`
- Probe scrubbed en control-dev. Sin mensajes a clientes.
- FCM accept ≠ recepción física A06 (verificación de outbox en aislado).
