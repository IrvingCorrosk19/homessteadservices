# Corrección pre-despliegue — Homestead Control (2026-10-03)

## Commits
- `96e149c` fix(control): enforce server edit gates, IG parent IDs, and notify claims
- `e50ead5` test(control): harden assertions and rewrite rollback without data loss
- `dd5e4a3` fix(control-mobile): align AI context copy with generator and review fallback

## Qué se corrigió
1. **Estados/versión en servidor** — `content-edit-guard` + media/action; bloquea publicación en curso, UNCERTAIN y post-live.
2. **IG child vs parent** — solo parent en `container_id`; escenarios `fail_ig_*` + recuperación.
3. **Outbox notify** — claim atómico PENDING→SENDING; reclaim stale; WhatsApp → `NEEDS_ACTION` (nunca SENT por link).
4. **Pruebas** — sin PASS diferido; parcial exige IG ok + FB fail; uncertain sin nuevas llamadas Meta; concurrencia y versión obsoleta; kinds api/sim/fisica_ui.
5. **Idempotencia** — hash incluye copy/note; conflicto; reclaim de recibos `__pending`.
6. **Copy** — `rewriteCopyOnly`; nota no literal; fallback marcado `needsReview`.
7. **Rollback** — código compatible + bloqueo ops; no restaurar DB encima de datos post-backup.

## Pruebas ejecutadas (sin Meta/clientes)
- `npm run control:test:carousel` → OK
- `npm run control:test` → OK
- Matrices HTTP (stabilize-final / physical A06) requieren `control:dev` en marcha; no se desplegó ni se contactó Meta.

## Archivos completos en este ZIP
Ver `01-codigo/` (publicación, versión, idempotencia, notificaciones) y `02-pruebas/`.
