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
- [x] **Preparación de compilación.** F8 verifica la versión y abre la comparación antes de ofrecer el guardado de un script manual. El detalle y las pruebas están en la sección de preparación.
- [x] **Estructura.** El editor muestra variables de paquete y distingue las funciones y procedimientos sobrecargados.
- [x] **Plegado.** Plegar paquetes, rutinas y bloques PL/SQL.
- [ ] **Autocompletado.** Sugerir palabras clave, objetos del esquema y columnas usando la sesión del programa.

### Menú de objeto en el editor

- [x] **Identificador.** `editorReference(state, position)` en `app/src/editorReference.ts` detecta un nombre simple o calificado bajo el puntero. Las pruebas cubren nombres entre comillas y descartan comentarios, literales, variables bind y enlaces remotos.
- [x] **Catálogo.** `editor_object(sessionId, owner, name, contextOwner)` resuelve el nombre exacto o un sinónimo local contra el diccionario con binds. `describe_columns(sessionId, owner, name)` entrega columnas de tablas y vistas. Ambas lecturas se ejecutan en el hilo de la sesión.
- [x] **Menú.** `ProgramEditor` obtiene la posición del clic. `ProgramWindow` reutiliza `ContextMenu` para Describir, Ver fuente, Copiar nombre y Copiar DDL. La prueba cubre la ruta de clic derecho y la sesión de origen.
- [ ] **Oracle real.** Verificar resolución de objetos y sinónimos locales y confirmar que se describen las columnas esperadas. Las columnas del catálogo fueron verificadas con metadatos y la prueba de la consulta completa recibió `DATABASE_OUT_OF_SCOPE` en DBX.

### Comparación de fuentes y control de cambios

- [x] **Versión por parte.** `load_program` carga el texto y `LAST_DDL_TIME` en la misma consulta por tipo. `ProgramPart.last_ddl_time` viaja como cadena o `null`. Una consulta sin fuentes devuelve una lista vacía. La apertura inicial sigue mostrando «Fuente no disponible» en ese caso.
- [x] **Comparación.** `ProgramWindow` consulta de nuevo en la sesión de origen y compara la parte solicitada con la versión abierta y el borrador local. `ProgramComparison.tsx` muestra diferencias con CodeMirror MergeView en modo de solo lectura. Las pruebas cubren cambios en el mismo segundo, cambios de metadatos, errores de lectura, ausencia de Body y conservación de cambios locales.
- [x] **Control de cambios.** F8 reutiliza la comparación para detectar conflictos antes de ofrecer un script manual. El prechequeo de lectura refleja el momento de la consulta.

### Preparación de compilación con F8

- [x] **Script local.** `prepareProgramScript(source, kind, target)` valida tipo, nombre y esquema del encabezado contra el objeto abierto. Escribe un nombre calificado y un terminador para SQL*Plus. Las pruebas cubren nombres entre comillas, encabezados de otro objeto y separadores ambiguos.
- [x] **Verificación previa.** F8 consulta la fuente actual con la sesión original, reutiliza la comparación y habilita **Guardar script** si se pudo verificar la versión. Si hay cambios, muestra las diferencias y requiere elegir **Guardar pese al cambio**. Una fuente o marca de DDL no visible impide exportar desde F8.
- [x] **Guardado.** `save_program_file` escribe el script para revisión y ejecución manual. El guardado conserva el borrador. Las pruebas cubren el descarte de lecturas pendientes al cerrar y el atajo F8 después de cambiar la conexión activa.

### Estructura y sobrecargas

- [x] **Ámbito.** `programStructure(source)` en `app/src/programStructure.ts` identifica declaraciones del nivel del paquete, conserva posiciones y excluye variables y subprogramas locales. Reutiliza la tokenización Oracle del editor para comentarios, cadenas e identificadores entre comillas.
- [x] **Firmas.** `ProgramDeclaration.key` normaliza las firmas sin valores por defecto. Se usa para emparejar Spec y Body, distinguir público de privado y preferir una implementación frente a su declaración adelantada.
- [x] **Navegación.** `ProgramWindow` presenta las firmas y variables de la parte activa. Clic salta al identificador. F12 abre un selector cuando hay varias declaraciones candidatas. `ProgramWindow.test.tsx` cubre ambos caminos de navegación.

### Plegado PL/SQL

- [x] **Delimitadores.** `programFoldRanges(source)` reutiliza el análisis de Estructura para emparejar bloques y cabeceras de paquete y rutina. `programFolding.test.ts` cubre comentarios, literales, directivas condicionales y bloques incompletos.
- [x] **Editor.** `programFolding` registra los rangos por documento en el servicio de CodeMirror. La apertura y el cierre quedan visibles. [Servicio de plegado en CodeMirror](https://codemirror.net/docs/ref/#language.foldService)
- [x] **Navegación.** Plegar y Desplegar están en el registro de atajos. `App.test.tsx` comprueba ambos atajos. `ProgramWindow.test.tsx` comprueba el plegado en modo de solo lectura y la navegación dentro de un rango plegado.

## Verificación

Ejecutar `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `npx.cmd tsc --noEmit` y `npm.cmd test` en sus carpetas correspondientes. Registrar resultados, límites y punto de continuación en [ESTADO.md](../../ESTADO.md).
