# OpenPL Plan 2 — Ventana de programa

**Objetivo:** abrir, navegar y editar fuentes PL/SQL en una ventana de programa.

**Arquitectura:** el núcleo lee el diccionario en el hilo de la sesión. React mantiene borradores por pestaña y muestra el editor CodeMirror 6 con los tokens existentes.

**Diseño:** [Ventana de programa, §7.4](../specs/2026-11-23-openpl-design.md#74-ventana-de-programa) y [nota de comportamiento](../../behavior/programa.md).

## Restricciones globales

- Oracle 12.1+, Instant Client 19/21, Windows y Linux. Ejemplos ficticios y desarrollo clean-room.
- Consultas Oracle de solo lectura durante el desarrollo. El primer incremento permite editar borradores y archivos locales. La compilación desde el editor queda pendiente.
- Tema grafito, IBM Plex Mono en el editor, textos breves en español y atajos registrados en `app/src/keymap.ts`.
- Dependencias con licencia compatible con Apache-2.0/MIT. Sin telemetría.

## Foco de revisión

- Spec y Body conservan borradores distintos al cambiar el panel activo.
- La identidad de cada objeto incluye sesión, tipo, esquema y nombre sin cambiar mayúsculas ni minúsculas.
- Un paquete sin Body sigue visible. Una fuente inaccesible produce un error recuperable.
- Cerrar una ventana con cambios pide confirmación. Los errores al abrir archivos o fuentes se muestran sin perder los borradores.
- Las coordenadas de Oracle corresponden a la fuente almacenada. Al normalizar el encabezado se conserva la numeración.

## Tareas

- [x] **Lectura.** `crates/openpl-core/src/program.rs` define `load_program(&DbConn, ObjectType, &str, &str) -> Result<Vec<ProgramPart>, DbError>`. Cada parte incluye tipo, texto y diagnósticos. IPC `program_source(sessionId, objectType, owner, name)` en `commands.rs`, registro en `lib.rs` y contrato en `api.ts`/`types.ts`. Pruebas de tipos y conservación de líneas en `crates/openpl-core/tests/program.rs`.
- [x] **Ventana.** `App.tsx` mantiene identidad y selección de documentos. `ObjectBrowser.tsx` envía el objeto y modo de apertura. `ProgramWindow.tsx` edita Spec/Body, navega estructura y problemas y alterna vista lateral. Las pruebas de los componentes cubren apertura, borradores, modo de solo lectura y navegación.
- [x] **Archivos.** Los comandos `open_program_file()` y `save_program_file(source, extension, name)` abren un selector nativo. El guardado usa reemplazo en el directorio de destino. `App.test.tsx` cubre cancelación, guardado y cierre con cambios.
- [ ] **Compilación.** Diseñar el control `LAST_DDL_TIME` por parte, el flujo de conflicto y la actualización de diagnósticos antes de exponer F8. Verificar con dobles de prueba.
- [ ] **Editor.** Ampliar la estructura para variables globales y sobrecargas, validar plegado de bloques y añadir autocompletado con el catálogo por conexión.

## Verificación

Ejecutar `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `npx.cmd tsc --noEmit` y `npm.cmd test` en sus carpetas correspondientes. Registrar resultados, límites y punto de continuación en [ESTADO.md](../../ESTADO.md).
