# HOMESTEAD — Mobile Operations UX

## Navigation

**Component:** `AdminMobileNav.tsx`

| Tab | Route | Rationale |
|-----|-------|-----------|
| Inicio | `/admin` | Attention + quick ops metrics |
| Solicitudes | `?ops=NEEDS_ATTENTION` | Default to pending |
| Citas | `/admin/citas` | Daily operations |
| Clientes | `/admin/clientes` | Lookup + 360 |
| Más | sheet | Trabajos, Retención, Copiloto, Operadores |

Desktop keeps full horizontal nav in `AdminTopBar`.

## Layout

- Admin shell: `pb-24 md:pb-0` for bottom nav clearance.
- Toast stack: `bottom-24` on mobile to avoid nav overlap.

## Solicitudes

- Filter chips: full width wrap, 44px touch targets.
- Cards: status badge visible in list header.
- Actions inline: Contactar + Marcar atendida.

## Solicitud detalle

- Sticky bar above bottom nav: Contactar + Atendida.
- Back link restores filter via `returnTo`.

## Citas

- **UpcomingSection** above calendar on `< xl`.
- Tap → **AppointmentDetailBottomSheet** immediately.
- Reprogramar inside sheet — no `scrollIntoView`.
- Week view: horizontal scroll + snap at 390px.

## Customer 360

- **Customer360OpsSummary** first operational block.
- Pending + next appointment + recovery at a glance.

## Search

- Top bar search button → panel.
- Ctrl+K on external keyboard.

## Touch & safe area

- `min-h-11` minimum interactive height.
- Bottom sheets: `env(safe-area-inset-bottom)`.
- Body scroll lock when sheet open.

## Tests

Static gates in `scripts/test-operations-ux-excellence.mjs` and `scripts/test-calendar-premium-ux.mjs`.

Manual E2E recommended at 390, 430, 768, 1366+ before VPS deploy.
