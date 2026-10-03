# Preparación de despliegue (NO ejecutado — producción intacta)

No se despliega, no se publica en Meta y no se envían mensajes reales.

## Backend control (cuando se autorice)

### Backup
1. En el VPS de control aislado: detener servicio solo tras snapshot.
2. Tarball del árbol de deploy + `DATA_DIR` de control-dev/control aislado (no DBs de clientes de producción pública).
3. Registrar commit actual (`git rev-parse HEAD`) y hash del tarball.

### Rollback
1. Restaurar tarball del commit previo operativo.
2. Reiniciar servicio control.
3. Verificar `/api/health` y que la sesión móvil reporta entorno aislado.
4. **Producción pública / Meta: fuera de alcance de este prep.**

## APK

| Variante | Firma | ¿Actualiza install A06 conservando datos? |
|---|---|---|
| Debug/pruebas `1.1.11+13` instalado ahora | Android **debug** keystore (`SHA256` cert `F6:FC:DC:3E:…:20:C5`) | **Sí** con `adb install -r` sobre la install debug actual |
| `flutter build apk --release` en este repo | También `signingConfig = debug` en `android/app/build.gradle.kts` | Sí frente a install debug; **no** es firma Play |
| Play / producción real | Keystore release **ausente del repo** | Sin ese keystore **no** se puede emitir un APK que actualice una install firmada por Play conservando datos |

### Instalación de prueba verificada
- Package: `lat.homestead.control`
- versionName `1.1.11` / versionCode `13`
- APK: `apps/homestead_control_mobile/build/app/outputs/flutter-apk/app-debug.apk`
- SHA-256: `A00CE28564932E7ACA795A07E6FA846CF4AE025623CC1F7F0570F7BC5635CD07`
- Device: `R8YYA17KR3V`
- Asserts: activos (build debug)

## Firma vs actualización con datos
La instalación física A06 es debug-signed (`PackageSignatures … 3c38eb8b`, cert debug). Cualquier APK firmado con el mismo debug keystore puede actualizarse con `-r` y conserva datos de app. Un APK firmado para Play **no** actualizará esa install (ni al revés) sin desinstalar.
