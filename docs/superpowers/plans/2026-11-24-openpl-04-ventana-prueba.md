# OpenPL Plan 4: Ventana de prueba

**Objetivo:** probar un procedimiento o una función desde una ventana con sesión propia. El núcleo lee la firma, genera un bloque anónimo editable con un bind por parámetro, lo ejecuta con binds de entrada y de salida y devuelve las salidas, `DBMS_OUTPUT` y el tiempo. La interfaz muestra la grilla de variables, la salida y el control de la transacción. La prueba se guarda y se reabre como `.tst`.

**Arquitectura:** la ventana reutiliza la sesión hermana de la Ventana SQL (`sql_open`, `sql_close`, `sql_cancel`, `sql_commit`, `sql_rollback`). `sql::execute` solo acepta binds de entrada, así que la ejecución con salidas vive en un módulo nuevo, `testrun.rs`. La firma (`routine.rs`) y el generador del bloque (`testblock.rs`) son independientes de la ejecución: el generador es una función pura y se prueba sin Oracle. La interfaz guarda las variables en `testVars.ts` y el archivo en `testFile.ts`, los dos sin UI.

**Diseño:** [§7.2 y §7.6](../specs/2026-11-23-openpl-design.md#76-ventana-de-prueba-test-window), decisión 7 de [ESTADO.md](../../ESTADO.md) (manda sobre las columnas de la grilla: usar, variable, tipo, valor), mockup privado "3 · Ventana de prueba" y [DESIGN.md](../../../DESIGN.md).

## Restricciones globales

- Oracle 12.1+, Instant Client 19/21. Nada exclusivo de 12.2+.
- Pruebas `live` solo `SELECT`, según la sección DEV de [AGENTS.md](../../../AGENTS.md). Lo que necesita un bloque PL/SQL o escribir lo prueba el usuario. Nunca contra producción.
- Sin datos reales en código, pruebas ni documentación: esquema `HR`, paquete `PKG_VENTAS`, `db.example.com:1521/DEVPDB`, alias `ORCL`.
- Atajos solo en `app/src/keymap.ts`. Textos cortos en español.
- Clean-room: no copiar código, textos, íconos ni marca de PL/SQL Developer. El formato `.tst` es propio.
- antislop durante el trabajo de UI: contraste medido, estados de carga, vacío y error, foco visible, nada sin acción. Cierre con el informe PASS/FAIL.
- TDD: cada tarea de núcleo y de lógica empieza con la prueba que falla.
- Un commit por tarea, en español, con prefijo `feat(core)`, `feat(app)` o `docs`.

## Foco de revisión

- La sesión de la ventana es independiente: su transacción y su cancelación no tocan la sesión principal ni otras ventanas (§7.2).
- Una prueba real puede escribir datos. Cerrar la ventana con transacción abierta pregunta Commit, Rollback o Cancelar, igual que la Ventana SQL.
- Los binds de salida declaran un tamaño máximo explícito; un valor más largo da error claro, no se trunca en silencio.
- El bloque generado usa notación nombrada (`p_cli => :p_cli`), así el orden de los parámetros no importa y omitir uno con DEFAULT es seguro.
- `ALL_ARGUMENTS` no lista de forma uniforme los procedimientos sin parámetros: la existencia de la rutina se confirma con `ALL_PROCEDURES`.
- Los subprogramas privados de un cuerpo de paquete no se pueden llamar desde afuera: error claro, sin generar un bloque que falla.
- El archivo `.tst` nunca guarda conexión, usuario ni contraseña.

## Núcleo (fase código, espera aprobación)

- [ ] **T1. Firma de rutinas.** `crates/openpl-core/src/routine.rs`.
  - `group_overloads(rows) -> Vec<Overload>`, pura: agrupa filas de `ALL_ARGUMENTS` por `OVERLOAD`, ordena por `POSITION`, separa el retorno (`POSITION = 0`) y marca `DATA_LEVEL > 0` como parte de un tipo compuesto, no como parámetro.
  - `list_overloads(conn, owner, package, name)`, Oracle, solo lectura: lee `ALL_ARGUMENTS` y confirma con `ALL_PROCEDURES` para cubrir las rutinas sin parámetros. Si la rutina no está en `ALL_PROCEDURES` (privada del cuerpo o inexistente), devuelve un error claro.
  - Metadatos verificados por DBX en desarrollo: ambas vistas exponen `SUBPROGRAM_ID` y `OVERLOAD`. Están disponibles `POSITION`, `SEQUENCE`, `DATA_LEVEL`, `DATA_TYPE`, `IN_OUT` y `DEFAULTED` en `ALL_ARGUMENTS`.
  - Pruebas: `group_overloads` con filas armadas a mano (función con retorno, procedimiento sin parámetros, dos sobrecargas, parámetro registro con campos); `live` de `list_overloads` solo con `SELECT` sobre `ALL_ARGUMENTS` y `ALL_PROCEDURES`, leyendo la firma de una rutina del sistema sin ejecutarla.
  - Commit: `feat(core): firma y sobrecargas de rutinas`.

- [ ] **T2. Generador del bloque.** `crates/openpl-core/src/testblock.rs`, función pura `generate(overload, uses) -> TestBlock` (texto del bloque más la lista de variables).
  - Notación nombrada. Función: `:result := pkg_ventas.calc_tot(p_cli => :p_cli);`.
  - Parámetros con `DEFAULTED = Y` marcados como no usados se omiten de la llamada.
  - BOOLEAN: variable local en un bloque `declare`, convertida desde y hacia un bind numérico 0/1.
  - Registros y colecciones: variable local declarada con su tipo y la marca `-- completar`; no se crea bind.
  - REF CURSOR de salida: bind de cursor.
  - Pruebas: un caso por regla de arriba, más nombres entre comillas y rutinas sueltas (sin paquete).
  - Commit: `feat(core): genera el bloque de prueba de una rutina`.

- [ ] **T3. Ejecución con salidas.** `crates/openpl-core/src/testrun.rs`, `run_test(session, block, vars) -> TestOutcome`.
  - Binds IN, OUT e IN OUT, con tamaño máximo explícito para cada OUT de texto, CLOB y RAW.
  - Habilita `DBMS_OUTPUT` antes de ejecutar y lo lee después, como la Ventana SQL.
  - `TestOutcome`: valores de salida como texto, líneas de `DBMS_OUTPUT`, tiempo, si dejó transacción abierta y error con posición.
  - Pruebas: armado de binds y conversión de valores sin Oracle.
  - PRUEBA DEL USUARIO (no la corren agentes): un bloque que llama `DBMS_UTILITY.GET_TIME` a un bind OUT y escribe con `DBMS_OUTPUT.PUT_LINE`.
  - Commit: `feat(core): ejecuta la prueba con binds de salida`.

- [ ] **T4. REF CURSOR de salida (spike).** Comprobar con rust-oracle 0.6 si un bind OUT de tipo REF CURSOR se puede leer como un conjunto de filas.
  - Si se puede: `TestOutcome` incluye las primeras N filas por cursor, como texto, de solo lectura.
  - Si no se puede: leer las primeras N filas por otro camino, o dejar el cursor fuera de v1 y documentarlo como limitación en ESTADO.
  - PRUEBA DEL USUARIO (no la corren agentes): bloque que abre un cursor sobre `DUAL`. El spike se resuelve con el resultado que informe el usuario.
  - Commit: `feat(core): lee REF CURSOR de salida en la prueba` (o `docs:` si queda como limitación).

- [ ] **T5. Comandos IPC.** `app/src-tauri/src/commands.rs`: `test_overloads`, `test_generate` y `test_run`. Usan la sesión que abre `sql_open`; cancelar, Commit, Rollback y cerrar siguen con `sql_cancel`, `sql_commit`, `sql_rollback` y `sql_close`.
  - Pruebas con `FakeConnector`, como las de `sql_*`.
  - Commit: `feat(app): comandos de la ventana de prueba`.

- [ ] **T6. Envoltorios y tipos.** `app/src/api.ts` y `app/src/types.ts`: `Overload`, `TestVar`, `TestBlock`, `TestOutcome` y las tres llamadas.
  - Prueba: `npx.cmd tsc --noEmit`.
  - Commit: `feat(app): tipos y llamadas de la ventana de prueba`.

- [ ] **T7. Lógica de variables, sin UI.** `app/src/testVars.ts` y `app/src/testVars.test.ts`.
  - Estado de la grilla: usar, valor, validación por tipo (NUMBER, DATE, TIMESTAMP, BOOLEAN 0/1), valores de salida después de ejecutar, regeneración del bloque al cambiar "usar".
  - Commit: `feat(app): estado de las variables de prueba`.

- [ ] **T8. Archivo `.tst`.** `app/src/testFile.ts`, `app/src/testFile.test.ts` y los comandos `open_test_file` y `save_test_file`.
  - Formato en texto, por líneas:
    ```
    -- openpl-test v1
    -- objeto: HR.PKG_VENTAS.CALC_TOT
    -- var {"name":"p_cli","type":"NUMBER","use":true,"value":"42"}
    -- var {"name":"result","type":"NUMBER","use":true,"value":""}
    begin
      :result := pkg_ventas.calc_tot(p_cli => :p_cli);
    end;
    ```
  - Una línea `-- var {json}` por variable y después el bloque. Nunca guardar conexión, usuario ni contraseña.
  - Pruebas: ida y vuelta, versión desconocida, línea `var` inválida, bloque con líneas que empiezan con `--`.
  - Commit: `feat(app): guarda y abre pruebas .tst`.

## Interfaz (BLOQUEADA por el mockup privado "3 · Ventana de prueba", no ejecutar)

- [ ] **T9. BLOQUEADO: `TestWindow.tsx`.** Editor del bloque, grilla de variables, F8 ejecutar, Cancelar con Shift Esc, Commit y Rollback, pestañas Salida y Resultados, estado y tiempo. Estados de carga, vacío y error. Prueba `TestWindow.test.tsx`.
- [ ] **T10. BLOQUEADO: puntos de entrada "Probar".** `ObjectBrowser.tsx` (procedimientos, funciones y paquetes) y `ProgramWindow.tsx` (panel Estructura). Diálogo de sobrecargas si hay más de una.
- [ ] **T11. BLOQUEADO: cableado.** `App.tsx` (abrir, cerrar con transacción abierta), `keymap.ts` (quitar `pending` de `test`), `newWindows.ts` (Nuevo > Ventana de prueba). Prueba en `App.test.tsx`.
- [ ] **T12. BLOQUEADO: cierre.** Informe antislop PASS/FAIL con el recorrido de cada control y registro en ESTADO.

## Bloqueos y decisiones abiertas

- Credenciales: variables `OPENPL_TEST_*` configuradas localmente; la contraseña la aporta el usuario; sin datos reales en el repo. Sin ellas, las pruebas `live` quedan en SKIP.
- Escrituras y compilaciones en DEV: las prueba el usuario.
- Mockup "3 · Ventana de prueba": el enlace es privado; T9 a T12 esperan acceso.
- Columnas de la grilla: usar, variable, tipo y valor (decisión 7), o también dirección (§7.6).
- Qué significa "usar". Propuesta: omitir solo parámetros con `DEFAULTED = Y`.
- "Nuevo > Ventana de prueba" sin objeto: bloque anónimo libre o elegir una rutina.
- Probar desde un paquete en el explorador: elegir la rutina en un diálogo o solo desde la ventana de programa.
- BOOLEAN en la grilla: 0/1 (propuesta) o TRUE/FALSE.
- Formato `.tst` con valores guardados, que pueden ser sensibles.
- Fuera de v1: estadísticas, profiler, trace y depuración (propuesta: afuera).
- Orden de merge de las ramas plan-1 a plan-4 hacia `main`: no se hace nada sin pedido.

## Riesgos

- `ALL_ARGUMENTS` no lista de forma uniforme los procedimientos sin parámetros. Se confirma con `ALL_PROCEDURES` (T1).
- Los binds IN OUT y REF CURSOR con rust-oracle 0.6 son un spike (T3, T4). Si REF CURSOR no se puede, queda como limitación documentada.
- Una prueba real puede escribir datos. La sesión es propia, Commit y Rollback son explícitos. Las pruebas automáticas contra DEV solo hacen `SELECT`; las que ejecutan bloques son del usuario.

## Pruebas

- Rust: `group_overloads` y `generate` puras con casos armados a mano; armado de binds de `run_test`; comandos `test_*` con `FakeConnector`; prueba `live` de `list_overloads` solo con `SELECT` (T1), en SKIP sin `OPENPL_TEST_*`.
- PRUEBA DEL USUARIO (no la corren agentes): ejecución de `run_test` con binds OUT y `DBMS_OUTPUT` (T3) y REF CURSOR sobre `DUAL` (T4).
- Interfaz: `testVars.test.ts`, `testFile.test.ts`. Bloqueadas: `TestWindow.test.tsx` y `App.test.tsx`.

## Verificación

En la raíz: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`. En `app/`: `npx.cmd tsc --noEmit`, `npm.cmd test`. Registrar en [ESTADO.md](../../ESTADO.md).
