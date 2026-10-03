# Flutter `_dependents.isEmpty` fix — delivery

## Causa
`InheritedElement.debugDeactivated` (framework.dart:6171) al confirmar el diálogo de seguridad:
controllers/`setState` durante teardown del route + teclado (MediaQuery dependents).

## Corrección (APK 1.1.10+12)
- `request_detail_screen.dart`: formularios de seguridad/disposición sin `TextEditingController`; `unfocus` antes de `pop`; `_awaitRouteTeardown` antes de `setState`.
- Debug build; asserts activos.

## Verificado en A06
- Seguridad HS-2026-000046: motivo `flutter-fix-402f0d03`, banner + historial SECURITY_REVIEW_SET al reabrir, sin pantalla roja.
- Rechazo HS-2026-000047: CANCELLED + REJECT, historial conservado, sin pantalla roja.
- Switch "Enviar mensaje al cliente" OFF; entorno aislado `127.0.0.1:3000` (no Meta real).

## Versiones
| Pieza | Valor |
|---|---|
| APK | 1.1.10+12 debug aislado |
| SHA-256 | EC96485F8B6C16F7313998BD94C9D44AA4F5097F22386226EDBF09E1A95B833B |
| Backend en corrida | 8f47eae (session.isolated=true) |
| Commit código backend r3b | 57246ec (selection/conflict/security proof) |
| Commit harness r3 | 2a91b7e |
| Commit este fix Flutter | 0dca002 |

## Relación 2a91b7e ? 57246ec ? corrida
- `2a91b7e`: harness/evidencia A06 r3 (no el fix Flutter).
- `57246ec`: cierre r3b backend (reprocess selección + conflicto + prueba seguridad).
- `8f47eae`: ZIP r3b delivery encima de 57246ec.
- La corrida de este fix Flutter se ejecutó contra backend `8f47eae` + cambios locales Flutter (luego fijados en el commit de este paquete). **No** se atribuye la ejecución del APK 1.1.10+12 a `57246ec` ni a `2a91b7e`; equivalencia backend = `8f47eae` (descendente de `57246ec`).

Producción intacta.

