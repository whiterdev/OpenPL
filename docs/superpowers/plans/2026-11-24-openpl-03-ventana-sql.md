# OpenPL Plan 3 — Ventana SQL

**Objetivo:** ejecutar SQL y PL/SQL en una ventana con sesión propia, ver resultados por partes, la salida de `DBMS_OUTPUT`, el historial y controlar la transacción. La edición en grilla es el segundo incremento.

**Arquitectura:** cada Ventana SQL abre una sesión hermana de la conexión activa (mismos parámetros, hilo propio). El núcleo ejecuta una sentencia por llamada, guarda el cursor abierto en la conexión y entrega páginas de filas como texto. La interfaz divide el script, resuelve la sentencia bajo el cursor y pide páginas al desplazarse.

**Diseño:** [§7.2 y §7.5](../specs/2026-11-23-openpl-design.md#75-ventana-sql-y-edición-en-grilla), mockup "2 · Ventana SQL" (página v2), [nota de comportamiento](../../behavior/sql.md) y [DESIGN.md](../../../DESIGN.md).

## Restricciones globales

- Oracle 12.1+, Instant Client 19/21. Nada exclusivo de 12.2+.
- Pruebas contra Oracle: solo lectura (`SELECT`, bloques anónimos que solo escriben en `DBMS_OUTPUT`). Nunca contra producción.
- antislop durante el trabajo: contraste medido, estados de carga, vacío y error, foco visible, nada sin acción. Cierre con el informe PASS/FAIL.
- Atajos solo en `app/src/keymap.ts`. Textos cortos en español.

## Foco de revisión

- La sesión de la ventana es independiente: su transacción y su cancelación no tocan la sesión principal ni otras ventanas.
- Cerrar una ventana con transacción abierta pregunta Commit, Rollback o Cancelar.
- Un cursor pertenece a su sesión. Ejecutar otra sentencia cierra el cursor anterior.
- Las posiciones de error de Oracle se trasladan al editor sumando el inicio de la sentencia.
- Los comandos SQL*Plus no se envían a Oracle: se informan y el script sigue.

## Incremento 1 — Ejecutar y ver (hecho)

### Núcleo

- [x] **Errores con posición.** `DbError.offset: Option<u32>` desde `oracle::DbError::offset()`.
- [x] **Sesión hermana y cancelación.** `SessionManager::open_sibling(id)` abre otra sesión con los parámetros de `id`. `Connector::interrupter` devuelve un manejador que llama `break_execution` desde otro hilo. `Session::interrupt()`.
- [x] **Ejecución.** `crates/openpl-core/src/sql.rs`: `execute(conn, sql, binds, page) -> ExecOutcome` (consulta con primera página, filas afectadas, bloque o DDL), `fetch(conn, cursor, n) -> QueryPage`, `commit`, `rollback`, `in_transaction` (`DBMS_TRANSACTION.LOCAL_TRANSACTION_ID`), `enable_output` y `read_output` (`DBMS_OUTPUT.GET_LINE` hasta agotar). Valores como texto, `NULL` aparte, LOB binarios como marca de tipo.
- [x] **IPC.** `sql_open(sessionId)`, `sql_close`, `sql_execute`, `sql_fetch`, `sql_cancel`, `sql_commit`, `sql_rollback`.

### Interfaz

- [x] **Script.** `app/src/sqlScript.ts`: `splitScript(text)` separa por `;` y por `/` en línea sola; los bloques PL/SQL (`DECLARE`, `BEGIN`, `CREATE ... PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE`) terminan solo en `/`. Respeta comentarios, literales, `q'[...]'` e identificadores entre comillas. Marca comandos SQL*Plus. `statementAt(list, pos)`.
- [x] **Variables.** `app/src/sqlBinds.ts`: binds `:x` (no `:=`, no dentro de literales) y sustituciones `&x`/`&&x`. Panel Variables con valor y tipo (Texto, Número, Fecha); se recuerdan por ventana.
- [x] **Ventana.** `SqlWindow.tsx`: editor, Ejecutar (F8) la sentencia bajo el cursor o la selección, Ejecutar script (Shift F8), Cancelar (Shift Esc). Pestañas Resultados, Salida y Historial. Grilla virtualizada con número de fila, `NULL` distinguible, más filas al bajar y **Traer todas**. Estado: filas, tiempo, transacción.
- [x] **Aplicación.** Pestañas comunes para programas y ventanas SQL. Nueva ventana SQL (Ctrl N, menú Nuevo). Commit (F10) y Rollback (Shift F10) en la barra superior para la ventana activa con indicador de transacción. Cierre con transacción abierta. Explorador: **Consultar datos** abre una ventana con `SELECT * FROM esquema.objeto`.

### Pruebas

- Rust: `splitScript` no está en Rust; sí `ExecOutcome` y conversión de verbos, `open_sibling` e `interrupt` con `FakeConnector`, y pruebas `live` de solo lectura (consulta paginada, bloque con `DBMS_OUTPUT`, error con posición).
- Interfaz: `sqlScript.test.ts`, `sqlBinds.test.ts`, `SqlWindow.test.tsx` (ejecutar, páginas, error marcado, salida, historial, cancelar), `App.test.tsx` (Ctrl N, Commit/Rollback, cierre con transacción).

## Incremento 2 — Edición en grilla

- [x] **Núcleo.** `crates/openpl-core/src/grid.rs`: `edit_target` (resuelve sinónimos, solo tablas, columnas editables por tipo), `apply` (savepoint, bloqueo `FOR UPDATE NOWAIT` y comparación de todas las filas, después UPDATE/DELETE/INSERT por ROWID; con conflicto o error vuelve al savepoint). IPC `sql_edit_target`, `sql_apply`.
- [x] **Consulta editable.** `app/src/sqlEdit.ts`: `editableQuery(sql)` agrega `alias.ROWID AS "OPENPL$ROWID"` y rechaza joins, agrupaciones, uniones, subconsultas y enlaces remotos.
- [x] **Grilla.** `ResultGrid.tsx` con selección y edición por teclado; `gridEdits.ts` arma los cambios y las filas aplicadas; `SqlWindow.tsx` con Editar (Ctrl E), agregar y borrar filas, Descartar, Aplicar (Ctrl Shift Enter), panel Conflictos y aviso de producción. Explorador: Editar datos en tablas.
- Diseño original de este incremento: candado Editar (Ctrl E) en consultas de una sola tabla con `ROWID` oculto; editar, insertar y borrar filas; Aplicar (Ctrl Shift Enter) con `SELECT ... FOR UPDATE NOWAIT` y comparación de valores; conflictos fila por fila. Sin vista previa del SQL (decisión 8 de ESTADO).

## Verificación

`cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `npx.cmd tsc --noEmit`, `npm.cmd test`. Registrar en [ESTADO.md](../../ESTADO.md).
