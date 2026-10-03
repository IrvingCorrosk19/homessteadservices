# Diagnóstico: `_dependents.isEmpty` en detalle de solicitud

Fecha: 2026-10-03  
Dispositivo: A06 (`R8YYA17KR3V`)  
APK base: Homestead Control `1.1.8+10` (debug aislado)

## Reproducción observada

Secuencia: abrir solicitud ficticia → **Marcar revisión seguridad** → motivo → **Confirmar**.

La primera excepción aparece **al confirmar el diálogo de seguridad** (antes de volver a la lista). Evidencia: `phone/07-sec-after-confirm.png` (pantalla roja).

Mensaje:

```
'package:flutter/src/widgets/framework.dart': Failed assertion: line 6171 pos 14:
'_dependents.isEmpty': is not true.
```

Línea 6171 en Flutter 3.35.5 = `InheritedElement.debugDeactivated()`.

## Causa (código)

En `request_detail_screen.dart` → `_securityReview`:

1. Se crea un `TextEditingController` **fuera** del diálogo.
2. El `TextField` del `AlertDialog` lo usa.
3. Al hacer `Navigator.pop`, `showDialog` completa **antes** de que el route termine de desmontar el árbol.
4. El código llama `reasonCtrl.dispose()` de inmediato.
5. Mientras el `TextField` aún se desactiva, quedan dependientes de `InheritedWidget` (tema/MediaQuery/etc.) → assert `_dependents.isEmpty`.

El mismo antipatrón existe en `_runDisposition` (bottom sheet) con tres controllers dispuestos al cerrar el sheet.

Nota: el comentario local sobre `DropdownButtonFormField` + `initialValue` documenta el mismo assert en otro camino; la falla reproducida en A06 es el dispose prematuro del controller del diálogo de seguridad.

## Corrección requerida

No ocultar asserts ni usar release. Mover ownership de controllers a `StatefulWidget` del diálogo/sheet y disponerlos en `State.dispose` (después del unmount).

## Actualizaci�n diagn�stico (post primer fix)

El APK 1.1.9+11 con controllers en `StatefulWidget` **sigui�** reproduciendo `_dependents.isEmpty` al confirmar seguridad (OCR `sec_confirm_red=true`), aunque el API s� persisti� la marca.

Conclusi�n refinada: no basta mover el `dispose` del controller. El assert en `InheritedElement.debugDeactivated` ocurre al cerrar el di�logo **con teclado abierto** (MediaQuery/viewInsets) mientras el route padre hace `setState`/`_load` antes de que terminen los dependents del overlay.

Correcci�n 1.1.10+12:
1. Formularios sin `TextEditingController` (`onChanged` ? `String` local).
2. `FocusScope.unfocus()` antes de `Navigator.pop`.
3. `_awaitRouteTeardown()` (frame + 50ms) antes de `setState` tras el di�logo/sheet.

