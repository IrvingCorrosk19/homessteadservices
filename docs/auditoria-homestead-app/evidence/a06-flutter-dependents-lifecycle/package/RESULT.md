# Cierre estabilización Flutter dependents (lifecycle)

## Artefactos de revisión
| Archivo | Contenido |
|---|---|
| `c32ee30-request_detail_screen.diff` | Diff del commit `c32ee309423d7f2e6de78b34d117edba344111dd` |
| `request_detail_screen-c32ee30.dart` | Archivo completo en ese commit |
| `request_detail_screen-current.dart` | Archivo completo post-lifecycle (`TransitionRoute.completed`) |
| `lifecycle-fix-since-c32ee30.diff` | Diff c32ee30 → actual (quita frame+50ms) |
| `logcat-sanitized-full.txt` | Log sanitizado del recorrido completo (incl. rechazo) |
| `../phone/*` | Capturas físicas cancel / teclado+confirmar / reopen / reject |
| `../verify-summary.json` | Resumen PASS |

## Garantía de cierre de diálogo (no timer)
`showDialog` / `showModalBottomSheet` completan su `Future` en **pop**, mientras la ruta de salida aún puede tener dependents de `InheritedWidget` (p. ej. `MediaQuery` del teclado).

Corrección: se hace `navigator.push` de `DialogRoute` / `ModalBottomSheetRoute` y se espera **`route.completed`** (`TransitionRoute`), que se resuelve cuando la transición de salida terminó y los overlay entries se removieron. Solo entonces corre `setState` / `_load`.

Se eliminó `_awaitRouteTeardown` (endOfFrame + 50 ms).

## Verificación física (asserts ON, debug 1.1.11+13)
- Cancelar diálogo → back: sin pantalla roja
- Confirmar seguridad con teclado abierto → back → reopen con banner: sin pantalla roja
- Rechazar (sheet cierra, status CANCELLED / dispositionKind REJECT): sin pantalla roja
- `dependents` / `Failed assertion` / `EXCEPTION CAUGHT` en logcat: **0**
- IDs: sec `HS-2026-000060`, cancel `HS-2026-000062`, rej `HS-2026-000061`
- Motivo único confirm: `life-confirm-86b64ad0`; reject detail: `life-reject-cc393647`

## Identificación build
| Campo | Valor |
|---|---|
| Commit lifecycle | `688ee30fa0d4c566e5711e0dcbdc7f7703d268a8` |
| Commit base (controller dispose) | `c32ee309423d7f2e6de78b34d117edba344111dd` |
| APK | `1.1.11+13` debug |
| SHA-256 | `A00CE28564932E7ACA795A07E6FA846CF4AE025623CC1F7F0570F7BC5635CD07` |
| Device | `R8YYA17KR3V` |
| Resultado físico | PASS (`verify-summary.json`) |
