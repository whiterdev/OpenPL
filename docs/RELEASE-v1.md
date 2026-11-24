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
