# OpenPL 1.0.0

Alcance de esta versión: sesiones y perfiles, explorador, editor PL/SQL, ventana SQL y pruebas de rutinas. [Estado del proyecto](ESTADO.md)

## Verificación de la candidata

- **Windows x64:** MSI y NSIS generados. El ejecutable anterior estaba abierto, por lo que se empaquetó el binario recién compilado desde un directorio separado.
- **Linux x64:** Debian y AppImage generados en un contenedor Debian 12. Los cuatro archivos se comprobaron por formato y SHA-256.
- **Automatización:** 368 pruebas de frontend, TypeScript, formato, Clippy y Rust en verde. El CI del commit `f6f1a18` pasó en Linux y Windows en el [PR #2](https://github.com/whiterdev/OpenPL/pull/2).
- **Oracle, solo lectura:** DBX confirmó las columnas de argumentos necesarias para dirección, valores predeterminados y tipos compuestos.

## Pendiente de calificación

- **Escritorio:** comprobar primera apertura, reconexión, editor SQL, prueba de una rutina, guardado y reapertura de `.tst`; probar la instalación por plataforma antes de distribuir.
- **Oracle:** verificar explorador y fuentes con lectura segura. Las pruebas manuales de ejecución, salidas y transacción corresponden al usuario en una base habilitada para ese circuito.
- **Distribución:** los paquetes locales son una candidata sin firma de publicación.

Los tipos compuestos se inicializan en el bloque. Las salidas CLOB se limitan a una vista de 128 KiB y los cursores de salida muestran hasta 50 filas. Los valores escritos en Variables quedan en memoria.

## Publicar

El workflow [release.yml](../.github/workflows/release.yml) se dispara al subir un tag `v*`. Compila en Windows el instalador NSIS firmado, publica el release (pre-release si el tag tiene sufijo, como `-beta.5`) y reemplaza `latest.json` en el release fijo `updater`, que es el que lee el actualizador de la app.

1. Subir la versión en los tres lugares: `Cargo.toml`, `app/package.json` y `app/package-lock.json` (desde `app/`: `npm.cmd version 1.0.0-beta.N --no-git-tag-version`, que actualiza los dos) y `app/src-tauri/tauri.conf.json`. El test `la_version_es_la_misma_en_todos_lados` falla si difieren, y el workflow se detiene si el tag no coincide con `tauri.conf.json`.
2. Abrir el PR y hacer merge a `main`.
3. Crear el tag anotado sobre el commit del merge y subirlo:

   ```
   git tag -a v1.0.0-beta.N -m "<notas>"
   git push origin v1.0.0-beta.N
   ```

   El mensaje del tag pasa a ser el cuerpo del release, seguido de "Compilada desde <hash>.". Formato habitual: primera línea "OpenPL 1.0.0 Beta N para Windows x64.", una línea en blanco y las novedades en viñetas. El título se arma solo: `v1.0.0-beta.N` da "OpenPL 1.0.0 Beta N" y `v1.0.0` da "OpenPL 1.0.0". El workflow hace el resto.
4. La primera instalación con actualizador (beta.5) es manual: descargar e instalar el instalador NSIS (`*-setup.exe`) del release. El `.exe` suelto de las betas anteriores no se actualiza solo y se puede borrar. Desde beta.5 la app avisa cuando hay una versión nueva.
5. Clave de firma: la privada está en la PC del responsable de releases, en `%USERPROFILE%\.tauri\openpl-updater.key`, y en los secrets del repo `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. La pública está en `plugins.updater.pubkey` de `tauri.conf.json`. Si se pierde la privada no se pueden firmar versiones nuevas y las instalaciones existentes dejan de aceptar actualizaciones: guardar una copia de respaldo fuera de la PC (con su contraseña).
