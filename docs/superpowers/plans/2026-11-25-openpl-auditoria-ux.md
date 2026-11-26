ENFOQUE: La rama única es `feat/auditoria-ux`, con un commit por brief y ejecución secuencial (no paralelizar). Primero va el contrato compartido de `keymap.ts` (`preventDefault` solo si hay acción o la tecla es del webview) y el editor (E1 a E4). Después vienen sesión y conexión, los módulos puros de SQL*Plus (`sqlplus*.ts`, que comparten la ventana SQL, la consola y `@archivo`), el Rust de SQL y la grilla. Al final van la consola (extraída antes a `CommandConsole.tsx`), el cableado de `SqlWindow.tsx`, el resto de App, la documentación y el cierre. Raíz: `C:\Users\Walter\Desktop\CLAUDE\OpenPL`; las rutas de los briefs son relativas a ella.

RIESGOS
1. **Ctrl+R choca con `refreshExplorer`** (`app/src/keymap.ts:116`). Para liberarlo, `refreshExplorer` pasa a Ctrl+Shift+R. Ctrl+R en ventanas sin editor editable sigue bloqueado como recarga, por la lista `isWebviewKey`, que pasa a ser el único punto de bloqueo del webview.
2. **El contrato de `handleShortcut` cambia.** Si la lista `isWebviewKey` omite una tecla del webview, esa tecla vuelve a funcionar y puede recargar. El brief 1 la cubre con tests.
3. **G7 no necesita Rust.** `commands.rs:102` es el error de compatibilidad, no la ejecución, y `error.rs:93-102` ya llena `offset`. El problema es el `?? 0` de la interfaz. ORA-06550 trae línea y columna solo en el mensaje.
4. **Corrección a G9.** Si `CASE` suma, `END CASE` también debe restar. Solo `END IF` y `END LOOP` se ignoran.
5. **Ctrl+C como cancelar en la consola** reutiliza la tecla de `commands.copyGrid.keys`. No define un atajo nuevo, solo cambia el comportamiento según el contexto.
6. **Dependencias nuevas.**
   - Crates `tauri-plugin-clipboard-manager` y `tauri-plugin-window-state`.
   - Paquete npm `@tauri-apps/plugin-clipboard-manager`.
   - Features `time` y `test-util` de tokio, que no son crates nuevos.
   - Licencias Apache-2.0 OR MIT, sin red.
7. **IPC de archivos con ruta libre** (`@archivo`, `SPOOL`). Mitigación: lista de extensiones, tope de 2 MiB, rutas relativas a Documentos y escritura atómica. No hay lista de carpetas permitidas.
8. **A13 persiste texto de ventanas SQL** en el directorio de configuración, que puede contener datos sensibles. Se guarda por perfil, con "Restaurar" o "Descartar" explícito.
   - No se persisten consolas, historial ni claves.
   - Los archivos locales se restauran como borrador, porque la app no guarda su ruta.
   - Los anchos de columna quedan fuera: no es simple, necesita una clave por consulta.
9. **Fechas ISO fijas (G12)** cambian lo que se ve en la grilla y la comparación optimista de `grid.rs`. No se puede verificar sin base. Queda como PRUEBA DEL USUARIO.
10. **Rutas de `sql.rs` sin cobertura offline** (G8, G12, G16). Los agentes solo prueban helpers puros. PL/SQL que falla y CLOB reales quedan como PRUEBA DEL USUARIO.
11. **Timeout de conexión.** rust-oracle no tiene uno nativo, así que se corta del lado de la app y la conexión tardía se cierra al llegar. No se usa Easy Connect Plus porque un cliente 12.1 no lo soporta.
12. **Archivos grandes.** `SqlWindow.tsx` tiene 1046 líneas y `App.tsx` 1167. Por eso el brief 35 extrae la consola antes de tocarla y los briefs de `SqlWindow.tsx` van seguidos.
13. **Tests y ejecución real.** `App.test.tsx` ("cerrar una ventana SQL con transacción abierta...") es inestable según ESTADO: reintentar una vez y anotarlo. EXEC, `@`, SPOOL y DESC no se ejecutan contra base; los tests usan un contexto falso. CONNECT queda fuera.
14. **`dragDropEnabled: false`** anula el evento nativo de Tauri. Se usa DnD HTML5 con `File.text()`, que da nombre y contenido pero no ruta.

**AGENTS.md sobre integrar.** La rama sale de `main` actualizado (`git pull`) y se llama `feat/&lt;tema&gt;`. Los commits son pequeños y en español. Al terminar, la feature queda en su rama. Merge a `main` y push solo si el usuario lo pide expresamente para esta entrega, sin reescribir historia. No hay regla de PR y no se trabaja en `main`. El brief 62 verifica, deja todo commiteado en la rama y reporta, sin merge, push ni PR.

PREÁMBULO (anteponer a cada brief)
- Rama `feat/auditoria-ux`, nunca `main`.
- TDD: el test falla primero por la razón correcta.
- Commit en español al final del brief.
- BASE DESA SOLO LECTURA: ningún comando, test o script contra una base y sin `OPENPL_TEST_*`. No ejecutar PL/SQL, DDL, DML, COMMIT ni ROLLBACK en ninguna base. Los tests usan fakes o funciones puras. Lo que necesite base real es PRUEBA DEL USUARIO.
- UI:
  - Textos cortos en español, íconos Phosphor, solo tokens de `theme.css`, sin em dash, sin datos reales (`HR`, `PKG_VENTAS`, `db.example.com`).
  - Atajos solo en `keymap.ts`.
  - Selección con fondo (y tilde en listas), sin bordes de color.
  - Foco visible y estados de carga, vacío y error.
- No tocar nada que no figure en ARCHIVOS.
- [TS] = `cd app; npx.cmd tsc --noEmit; npm.cmd test`.
- [RS] = raíz: `cargo fmt --all --check; cargo clippy --workspace --all-targets -- -D warnings; cargo test --workspace`.
- [DEP] = agrega dependencias. [PU] = requiere prueba del usuario.

FASE 1: teclado y editor

BRIEF 1: contrato de keymap
OBJETIVO: `preventDefault` solo si hay acción o la tecla es del webview; alias; comandos nuevos (E1, A11, E6, E8, E12, E15, G18).
ARCHIVOS: `app/src/keymap.ts`, `app/src/keymap.test.ts`. Ajustar tests existentes que lean `commands.replace.keys` o `commands.refreshExplorer.keys`.
CONTEXTO: `handleShortcut` (:156-171) bloquea toda coincidencia. `Command` solo tiene `keys` y `list` está en :61-118.
PASOS:
1. Crear la rama: `git switch main; git pull --ff-only; git switch -c feat/auditoria-ux`.
2. Tests: Ctrl+A, Ctrl+Shift+End y Shift+F10 sin acción no llaman `preventDefault`. F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5, Ctrl+P, Ctrl+U, Ctrl+Shift+I y Ctrl++/-/0 sí. Exportar `isWebviewKey(e)`.
3. `Command.alt?: string[]`. `matches` y el test de duplicados cubren `alt`, y los menús muestran solo `keys`.
4. Una acción puede devolver `false` para indicar que no manejó la tecla. Tipo `() =&gt; void | boolean`.
5. Teclas: `replace` pasa a Ctrl+R con alt Ctrl+H. `refreshExplorer` pasa a Ctrl+Shift+R. `redo` suma alt Ctrl+Y. `execute` suma alt Ctrl+Enter.
6. Ids nuevos: `findNext` F3, `findPrev` Shift+F3, `nextTab` Ctrl+Tab, `prevTab` Ctrl+Shift+Tab, `moveTabLeft` Ctrl+Shift+PageUp, `moveTabRight` Ctrl+Shift+PageDown, `clearConsole` Ctrl+L, `viewCell` Shift+Space.
7. `KeyLike` suma `getModifierState?` opcional. Con AltGraph activo, `matches` da false (E12).
CRITERIO: [TS].
NO TOCAR: `App.tsx` y los componentes.
DEPENDE DE: ninguna.

BRIEF 2 [DEP]: plugins de portapapeles y estado de ventana
OBJETIVO: lectura y escritura de portapapeles (E3) y tamaño y posición de ventana recordados (A12).
ARCHIVOS: `app/src-tauri/Cargo.toml` (+`Cargo.lock`), `app/src-tauri/src/lib.rs`, `app/src-tauri/capabilities/default.json`, `app/package.json` (+lock), `app/src/api.ts`, test de api.
CONTEXTO: hoy `capabilities` solo tiene `core:default` y `core:window:allow-destroy`. `isTauri()` viene de `@tauri-apps/api/core`.
PASOS:
1. Agregar los crates `tauri-plugin-clipboard-manager 2` y `tauri-plugin-window-state 2`, y el paquete npm `@tauri-apps/plugin-clipboard-manager ^2`.
2. Registrar ambos plugins en `lib.rs`.
3. Permisos mínimos: `clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text` y `window-state:default`.
4. En `api.ts`, `clipboard.readText()` y `clipboard.writeText(s)`, con fallback a `navigator.clipboard` si no es Tauri. Test con el módulo simulado.
CRITERIO: [RS] y [TS].
NO TOCAR: `tauri.conf.json`.
DEPENDE DE: ninguna.
[PU]: reabrir la app restaura tamaño y posición; Pegar desde el menú funciona en Windows.

BRIEF 3: teclas estándar y autocompletado del editor
OBJETIVO: Enter con sangría, Home y Ctrl+flechas, y completado sin preselección (E2, E4, E10 parcial).
ARCHIVOS: `app/src/components/ProgramEditor.tsx` (`editingExtensions`, :86-98), `app/src/components/ProgramEditor.test.tsx`.
CONTEXTO: no hay `defaultKeymap`; solo `indentKeys` y `autocompletion({override, icons:false})`. Usar `standardKeymap` de `@codemirror/commands`. NO `defaultKeymap`, porque choca con `keymap.ts`.
PASOS:
1. Tests: Enter conserva la sangría. Home va al primer no blanco y un segundo Home a la columna 0. Ctrl+flecha y Ctrl+Backspace actúan por palabra. Ctrl+A selecciona todo. Con el completado abierto y sin selección, Enter inserta salto. Tras ArrowDown, Enter acepta.
2. `keymap.of(standardKeymap)` también en solo lectura, después de `indentKeys` para no pisar Tab.
3. `autocompletion({selectOnOpen:false})`.
CRITERIO: [TS].
NO TOCAR: `keymap.ts` y las demás extensiones.
DEPENDE DE: 1.

BRIEF 4: menú contextual del editor
OBJETIVO: Cortar, Copiar, Pegar, Seleccionar todo, Deshacer y Rehacer en los editores de programa y de SQL; también por teclado (E3, A10, A11).
ARCHIVOS: `app/src/editorMenu.ts` (+test, nuevos), `app/src/components/ProgramEditor.tsx` (:57, :119-133), `app/src/components/ProgramWindow.tsx` (:511, :532, :573).
CONTEXTO: `ProgramEditor` solo emite `onObjectContext` si hay referencia. `ProgramWindow` tiene su propio `ContextMenu` con `[readOnlyItem]`. `SqlWindow` usa `ProgramEditor` sin menú. `ContextMenu` recibe `{x,y,label,items,onClose}`. Portapapeles: `api.clipboard` (brief 2).
PASOS:
1. `editorMenuItems(view,{readOnly,extra})`: ítems con el atajo de `keymap.ts` visible. En solo lectura, Cortar y Pegar quedan deshabilitados. Sin selección, Cortar y Copiar quedan deshabilitados.
2. `ProgramEditor` renderiza el `ContextMenu` y recibe `menuExtra?`. Con un nombre de objeto abre `EditorObjectMenu`; si no, el menú base más `extra`.
3. Contextmenu por teclado (Shift+F10 y tecla Menú, `clientX=0`): anclar en `view.coordsAtPos(head)`.
4. `ProgramWindow` pasa `readOnlyItem` como `menuExtra` y elimina su `ContextMenu` duplicado, conservando "Solo lectura".
CRITERIO: [TS].
NO TOCAR: `App.tsx`.
DEPENDE DE: 1, 2, 3.

BRIEF 5: App, teclado, rueda y menú
OBJETIVO: dejar de bloquear teclas legítimas y bloquear las del webview (E1, E8, E3 y A10 parte App, A11).
ARCHIVOS: `app/src/App.tsx` (:135-145, :278-318), `app/src/App.test.tsx`.
PASOS:
1. Tests: Ctrl+A en el editor no se bloquea. Ctrl+R sin acción y con modales abiertos no recarga. Ctrl+rueda no hace zoom (listener `wheel` con `passive:false`). Ctrl+P, Ctrl+U y Ctrl+Shift+I quedan bloqueados.
2. `contextmenu` dentro de `.cm-editor` no se previene (decide `ProgramEditor`). Fuera de inputs y editor sí.
3. Reemplazar el bloqueo manual de `explainPlan` y `refreshExplorer` (:283-289) por `isWebviewKey`.
4. Adaptar el tipo de `actions` al retorno `false`.
5. Mantener el filtro `editorEdits` (:292-299) solo para inputs y textareas reales.
CRITERIO: [TS].
NO TOCAR: `keymap.ts` y los componentes.
DEPENDE DE: 1, 4.

BRIEF 6: foco y estado del editor
OBJETIVO: foco al activar una pestaña de programa, al cerrar la descripción y al recargar partes (E5, E13, E14 parte editor).
ARCHIVOS: `app/src/components/ProgramWindow.tsx` (:102, :178-183), `app/src/components/ProgramEditor.tsx` (:159), `app/src/components/EditorObjectMenu.tsx` (:93), tests. `App.tsx:659` solo si hace falta.
CONTEXTO: `App.tsx:995` oculta las pestañas con `hidden`. `ProgramEditor` recrea el `EditorView` cuando cambia `part`.
PASOS:
1. Tests: al volverse activa la pestaña el editor recibe foco, salvo que haya un diálogo o el foco esté en un campo propio. Cerrar `EditorObjectMenu` devuelve el foco al editor.
2. Tras recargar con partes nuevas, el editor no se recrea si el texto coincide. Si Oracle cambió y no hay cambios locales, se reemplaza el texto por dispatch conservando el historial de deshacer. `ProgramWindow` resincroniza `values`. Un borrador sucio no se pisa.
CRITERIO: [TS].
NO TOCAR: la lógica de compilar.
DEPENDE DE: 4.

BRIEF 7: rendimiento del editor
OBJETIVO: sin costo O(documento) por tecla (E9).
ARCHIVOS: `app/src/components/ProgramEditor.tsx` (:134-137), `app/src/components/ProgramWindow.tsx` (:133, :544-550), `app/src/App.tsx` (`onDirty`), tests.
PASOS:
1. Tests con fuente grande y timers falsos: tipear no llama `doc.toString()` por tecla. `programStructure` y los marcadores se recalculan tras una pausa de unos 150 ms. `onDirty` solo se llama al cambiar entre limpio y sucio.
2. Diferir `onChange` (o pasar un `getText()` perezoso) y calcular el estado sucio con `doc.eq` contra la línea base.
3. En `App`, memoizar `setValues` y `onDirty` para que no re-renderice por tecla.
CRITERIO: [TS].
DEPENDE DE: 6.
[PU]: sensación con un paquete grande.

BRIEF 8: búsqueda (contador y F3)
OBJETIVO: el contador no recalcula por cada movimiento del cursor, y F3 y Shift+F3 buscan siguiente y anterior (E11, E10, E15).
ARCHIVOS: `app/src/components/EditorSearch.tsx` (:78, :188), `EditorSearch.test.tsx`, `app/src/components/ProgramWindow.tsx` (acciones), `app/src/App.tsx` (lista de ids ~:200-233).
PASOS:
1. El contador solo recalcula cuando cambian la consulta, el documento o las opciones. Probar con un spy.
2. Exportar `findNextMatch(view)` y `findPrevMatch(view)`. Sin consulta abren la barra.
3. Agregar `findNext` y `findPrev` a `ProgramActions` y a la lista de ids de `App`, también en solo lectura.
4. Test en `ProgramWindow`: Ctrl+R y Ctrl+H abren Reemplazar, y en solo lectura siguen deshabilitados.
CRITERIO: [TS].
NO TOCAR: `SqlWindow.tsx` (brief 50).
DEPENDE DE: 1.

FASE 2: sesión y conexión

BRIEF 9: clasificación de errores y timeout al conectar (Rust)
OBJETIVO: ORA-12170, ORA-28000 y ORA-28001 con mensaje útil, y la conexión no cuelga (A5, A8).
ARCHIVOS: `crates/openpl-oracle/src/error.rs` (:30-39, :69), `app/src-tauri/src/commands.rs` (`connect_impl` :87-110), `app/src-tauri/Cargo.toml` (feature tokio `time` y dev `test-util`), `app/src/types.ts` (`ErrorKind`).
CONTEXTO: `ErrorKind` actual: ClientMissing, InvalidCredentials, PasswordExpired, UnknownService, ConnectionLost, Other.
PASOS:
1. Tests en `error.rs`. ORA-12170 pasa a `Timeout` ("No se alcanzó el servidor."). ORA-28000 pasa a `AccountLocked` ("Cuenta bloqueada."). ORA-28001 conserva `PasswordExpired` con el siguiente paso en el texto ("Clave vencida. Cámbiala y vuelve a conectar.").
2. Espejar los kinds nuevos en `types.ts`.
3. `connect_impl` envuelve `sessions.open` en `tokio::time::timeout(20 s)`. Al vencer devuelve `DbError` `Timeout`; si la conexión llega tarde se cierra, sin sesión huérfana. Test con conector falso lento y `tokio::time::pause`.
CRITERIO: [RS] y [TS].
DEPENDE DE: ninguna.
[PU]: host inalcanzable, nunca contra DESA.

BRIEF 10: sesiones hermanas (Rust)
OBJETIVO: backend para cerrar en cascada, listar y comprobar sesiones (A1, A2, A3).
ARCHIVOS: `crates/openpl-core/src/session.rs` (:169-230), `app/src-tauri/src/commands.rs` (:112-130), `app/src-tauri/src/lib.rs`, `app/src/api.ts`.
CONTEXTO: `open_sibling` está en :213. `DbConn::ping` (`connect.rs:81`) no se usa, y `api.sessionState` nunca se invoca.
PASOS:
1. El manager registra las hermanas por padre. `siblings(parent)` las lista y `close(parent)` las cierra en cascada. Probar con `FakeConnector`.
2. `session_ping(id) -&gt; bool` hace ping en el hilo de la sesión y, si falla, la marca desconectada. Si la sesión está ocupada devuelve true sin encolar.
3. Comandos IPC `session_siblings` y `session_ping`, con sus envoltorios en `api.ts`.
4. Test: `reconnect` por id de una hermana funciona.
CRITERIO: [RS] y [TS].
DEPENDE DE: 9.

BRIEF 11: desconectar con confirmación
OBJETIVO: desconectar avisa de las transacciones abiertas y cierra las hermanas (A1, A20 parte).
ARCHIVOS: `app/src/App.tsx` (:345-352), `app/src/components/ConnectionBar.tsx` (:113-122), `App.test.tsx`.
PASOS:
1. Test: desconectar con ventanas SQL de esa conexión con transacción abierta pregunta (reutilizar `TransactionDialog` o el patrón de cierre de pestaña).
2. Al confirmar, el backend cierra las hermanas y las pestañas SQL quedan marcadas como desconectadas. Los programas con cambios no se pierden.
3. El error de desconexión (:345-347) se muestra como aviso, no en silencio.
CRITERIO: [TS].
DEPENDE DE: 10.

BRIEF 12: reconexión de pestañas y detección de caída
OBJETIVO: reconectar las ventanas SQL y detectar la caída al volver el foco (A2, A3, G11).
ARCHIVOS: `app/src/App.tsx` (:273, :353-366, :852), `app/src/components/SqlWindow.tsx` (franja mínima), tests.
PASOS:
1. Reconectar la principal reconecta también las hermanas (`sessionSiblings` más `reconnect` por id). Los errores se ven en su pestaña.
2. Una pestaña SQL con sesión caída muestra la franja "Sesión caída" con un botón Reconectar, solo para esa sesión.
3. En el evento `focus` de la ventana y en `visibilitychange`, llamar `sessionPing` a la principal y a las hermanas ociosas, como máximo una vez cada 10 s. Si falla, marcar desconectada con motivo.
4. Con la sesión desconectada, F8 muestra el motivo y ofrece reconectar en vez del error crudo.
CRITERIO: [TS].
DEPENDE DE: 10, 11.

BRIEF 13: LoginDialog
OBJETIVO: progreso al conectar, contraseña conservada salvo credenciales, etiqueta y borrado de perfiles (A5, A7, A18, A19, A20).
ARCHIVOS: `app/src/components/LoginDialog.tsx` (:113-115, :140, :147-148, :352, :362), `LoginDialog.test.tsx`.
PASOS:
1. Mientras conecta, el botón dice "Conectando..." y está deshabilitado, con Cancelar. Cancelar ignora el resultado tardío y cierra la sesión si llega.
2. La contraseña se borra solo con ORA-01017, ORA-01005 y ORA-01045, por código y no por kind.
3. Etiqueta del perfil tomada de los campos actuales al guardar (formato `usuario en servicio`).
4. Eliminar perfil pide confirmación ("Eliminar HR en DEV").
5. Conectar no muestra Ctrl+Shift+L; sin atajo visible o con Enter.
6. El error al cargar perfiles (:113-115) se ve.
CRITERIO: [TS].
DEPENDE DE: 9.

BRIEF 14: explorador con flechas
OBJETIVO: navegación por teclado del árbol (A4, A19 parte explorador).
ARCHIVOS: `app/src/components/ObjectBrowser.tsx` (:271, :293-296, :310, :346, :366, :369), `ObjectBrowser.test.tsx`.
CONTEXTO: cada fila tiene `tabIndex=0` y usa `useVirtualizer`. Hoy solo funcionan Enter y Ctrl+C.
PASOS:
1. Roving tabindex: una sola fila con `tabIndex=0` y las demás con -1.
2. ↑, ↓, Inicio y Fin mueven el foco. `scrollToIndex` y luego `focus` cuando el nodo exista.
3. → expande, o baja al primer hijo. ← contrae, o sube al padre.
4. Roles `tree` y `treeitem` con `aria-level` y `aria-expanded` si faltan.
5. Los ítems deshabilitados dicen por qué ("Sin conexión", "Próximamente") con `title` y `aria-describedby`.
CRITERIO: [TS].
NO TOCAR: Enter y Ctrl+C actuales.
DEPENDE DE: ninguna.

FASE 3: módulos puros de SQL y Rust de SQL

BRIEF 15: divisor de scripts (G9)
OBJETIVO: bloques PL/SQL sin `/` ya no absorben lo que sigue, y el cursor sobre un comentario ejecuta la sentencia correcta.
ARCHIVOS: `app/src/sqlScript.ts` (:125-203), `app/src/sqlScript.test.ts` (:31-46).
CONTEXTO: `splitScript(source): ScriptStatement[]` y `statementAt`; los kinds son `sql`, `plsql` y `sqlplus`. Hoy los tests siempre usan `/`.
PASOS:
1. Tests sin `/`:
   - `begin null; end;` seguido de `select 1 from dual;` da 2 sentencias.
   - `DECLARE...BEGIN...END`.
   - CREATE PROCEDURE, FUNCTION o TRIGGER termina cuando la profundidad vuelve a 0.
   - PACKAGE spec, y PACKAGE o TYPE BODY con rutinas anidadas, termina cuando `END` baja a -1.
2. Profundidad: `BEGIN` y `CASE` suman. `END` resta, salvo `END IF` y `END LOOP`; `END CASE` sí resta. Ignorar comentarios, strings y `q'[...]'`. Un `/` solo en su línea también termina el bloque.
3. `statementAt`: un comentario o espacio entre sentencias pertenece a la siguiente. Después de la última devuelve ninguna. Mantener la firma.
CRITERIO: [TS].
NO TOCAR: `SqlWindow.tsx`.
DEPENDE DE: ninguna.

BRIEF 16: parser SQL*Plus y EXEC (G10, C12)
OBJETIVO: parser puro de comandos SQL*Plus. EXEC se traduce a bloque y los demás dejan de omitirse.
ARCHIVOS: `app/src/sqlplus.ts` (+test, nuevos), `app/src/sqlScript.ts`, `sqlScript.test.ts`.
CONTEXTO: `parseSqlplus(line) -&gt; SqlplusCommand | null` con uniones: `exec{block}`, `set{option,value}`, `show{what}`, `define{variable?,value?}`, `undefine`, `variable{variable,type}`, `print{variable?}`, `spool{target|"off"}`, `start{path,nested}`, `desc{target}`, `unsupported{text}`. Es insensible a mayúsculas y acepta `@`, `@@`, `START`, `VAR`, `EXECUTE` y `DESCRIBE`. `CONNECT` y similares dan `unsupported`.
PASOS:
1. Tests: `EXEC foo(1)` da `BEGIN foo(1); END;` sin duplicar el `;`. `EXEC :x := 1` también.
2. `splitScript` emite EXEC como `plsql` ya traducido. Los demás comandos mantienen el kind `sqlplus` con `command` parseado.
3. `SqlWindow.tsx` sigue omitiendo los `sqlplus` hasta el brief 44; solo ajustar el tipo si hace falta.
CRITERIO: [TS].
DEPENDE DE: 15.

BRIEF 17: ubicar errores (G7, C9)
OBJETIVO: línea y columna de un error, sin el `?? 0`.
ARCHIVOS: `app/src/sqlError.ts` (+test, nuevos).
CONTEXTO: `types.ts:255` ya trae `offset`, que viene de `error.rs:97` y es null si es 0.
PASOS:
1. `locateError(sql, {message, offset})` devuelve `{line, column, snippet, caret}` o `null`. Usa `offset` (verificar si cuenta caracteres o bytes y convertir). Si es null, parsea "line X, column Y" o "línea X, columna Y" del mensaje (ORA-06550). Nunca devuelve posición 0 inventada.
2. `formatConsoleError(code, message, loc)` devuelve las líneas "ORA-00942: ...", "Línea 1, columna 15" y el fragmento con `^`.
3. Tests con multibyte y con ORA-06550.
CRITERIO: [TS].
DEPENDE DE: ninguna.

BRIEF 18: variables `&amp;x` y `:x` (G17)
OBJETIVO: reconocer `q'[...]'` y detectar variables de todo el script.
ARCHIVOS: `app/src/sqlBinds.ts` (:14-35), `app/src/sqlBinds.test.ts`.
PASOS:
1. Ignorar `&amp;x` y `:x` dentro de `q'[..]'`, `q'{}'`, `q'()'`, `q'&lt;&gt;'`, `q'!..!'` y `nq'...'`.
2. `findVariables(script)` sobre todo el script, con cantidad de usos por variable. `applySubstitutions` no cambia de firma.
CRITERIO: [TS].
DEPENDE DE: ninguna.

BRIEF 19: riesgo de sentencia (A17, parte pura)
OBJETIVO: clasificar lectura y escritura.
ARCHIVOS: `app/src/sqlRisk.ts` (+test, nuevos).
PASOS:
1. `statementRisk(sql, kind)` devuelve `"read"` o `"write"`. SELECT, WITH y EXPLAIN son lectura. `SELECT ... FOR UPDATE`, DML, DDL, PL/SQL anónimo, EXEC, COMMIT y ROLLBACK son escritura. Ignora comentarios iniciales.
2. `needsConfirm(statements)` devuelve un resumen ("2 de escritura").
3. Tabla de unos 30 casos.
CRITERIO: [TS].
DEPENDE DE: 16.

BRIEF 20: salida tabular estilo SQL*Plus (C8, parte pura)
OBJETIVO: formatear resultados como texto.
ARCHIVOS: `app/src/sqlplusFormat.ts` (+test, nuevos).
CONTEXTO: `SqlColumn` está en `types.ts`; usar su tipo para decidir si la columna es numérica.
PASOS:
1. `formatTable(columns, rows, {linesize, pagesize, heading}) -&gt; string[]`. Ancho por columna igual al máximo entre nombre y valores, con tope. Números a la derecha. NULL como vacío.
2. Si la fila excede `linesize`, se parte en tramos de columnas. `pagesize` repite el encabezado cada N filas (0 sin paginar). `heading` off omite el encabezado.
3. `feedbackLine(count)` devuelve "1 fila seleccionada.", "N filas seleccionadas." o "ninguna fila seleccionada.".
CRITERIO: [TS].
DEPENDE DE: ninguna.

BRIEF 21 [PU]: DBMS_OUTPUT cuando falla (G8)
OBJETIVO: no perder la salida de un bloque que falla.
ARCHIVOS: `crates/openpl-core/src/sql.rs` (:450, :468-475), `app/src/types.ts` (`ExecResult`), `app/src/components/SqlWindow.tsx` (manejo mínimo), tests.
CONTEXTO: `execute_named(...)?` corta antes de `read_output`.
PASOS:
1. Si falla la ejecución (no una conexión perdida), devolver `Ok(ExecOutcome)` con `result: ExecResult::Failed{error}`, `output`, `transaction` y `elapsed_ms`. Un `ConnectionLost` sigue como `Err`.
2. Helper puro `failed_outcome(...)` con test.
3. En `SqlWindow`, tratar `Failed` como el error actual, mostrando antes el `output`. La UI completa va en el brief 42.
CRITERIO: [RS] y [TS].
NO TOCAR: la ruta de éxito.
DEPENDE DE: ninguna.

BRIEF 22 [PU]: fechas en formato fijo (G12)
OBJETIVO: DATE y TIMESTAMP en ISO fijo, coherente con `typed()` y `bind_param`.
ARCHIVOS: `crates/openpl-core/src/value_fmt.rs` (nuevo), `crates/openpl-core/src/lib.rs`, `crates/openpl-core/src/sql.rs` (:283-332), `crates/openpl-core/src/grid.rs` (:181-222).
CONTEXTO: hoy la grilla muestra texto NLS, y `typed()` y `bind_param` solo aceptan ISO. Formatos:
- `DATE`: `YYYY-MM-DD HH24:MI:SS`.
- `TIMESTAMP`: `YYYY-MM-DD HH24:MI:SS.ff` (fracción solo si no es 0).
- `TIMESTAMP WITH TIME ZONE`: suma ` +HH:MM`.
- `LOCAL TIME ZONE`: sin zona.
Usar `oracle::sql_type::Timestamp`.
PASOS:
1. Tests puros: formato y parseo ida y vuelta. El parseo acepta fecha sola, `T`, fracción y `+05:30` o `Z`, y rechaza basura.
2. Las celdas de la grilla usan el formato fijo sin `ALTER SESSION`.
3. `typed()` y `bind_param` usan el mismo parseo.
4. La comparación optimista de `grid.rs` compara formato fijo contra formato fijo.
CRITERIO: [RS].
DEPENDE DE: 21 (mismo `sql.rs`).
[PU]: `SELECT` de fechas, y editar fechas en una base de pruebas.

BRIEF 23 [PU]: tope de LOB (G16)
OBJETIVO: acotar la memoria de CLOB y marcar las columnas.
ARCHIVOS: `crates/openpl-core/src/sql.rs` (:319-332), `app/src/types.ts` (`SqlColumn.lob`).
PASOS:
1. Las columnas CLOB, NCLOB y LONG se leen con tope de 1.000.000 caracteres. Helper puro `cap_text(s, cap) -&gt; (String, bool)` con test.
2. `SqlColumn.lob: boolean`. La edición en grilla tratará esas columnas como solo lectura (brief 34).
CRITERIO: [RS] y [TS].
DEPENDE DE: 22.

BRIEF 24: IPC de lectura y escritura de texto
OBJETIVO: leer un script y escribir la salida de SPOOL.
ARCHIVOS: `app/src-tauri/src/commands.rs` (junto a :468-535), `app/src-tauri/src/lib.rs`, `app/src/api.ts`.
CONTEXTO: `open_program_file` y `save_program_file` usan un selector; no hay lectura ni escritura por ruta. Reutilizable: `replace_program_file` (escritura atómica).
PASOS:
1. `read_script_file(path) -&gt; {name, path, source}`. Agrega `.sql` si no hay extensión. Tope de 2 MiB. UTF-8 con reemplazo.
2. `write_spool_file(path, text) -&gt; String` con la ruta resuelta. Extensiones permitidas: `lst`, `log`, `txt`, `csv`, `sql`. `.lst` por defecto. Usa `replace_program_file`.
3. Las rutas relativas se resuelven contra `dirs::document_dir()` (inyectable para tests).
4. Tests de `*_impl` con `tempfile`: extensión, tope, relativa y errores en español.
5. Envoltorios `api.readScriptFile` y `api.writeSpoolFile`.
CRITERIO: [RS] y [TS].
DEPENDE DE: ninguna.

BRIEF 25: estado y ejecutor SQL*Plus
OBJETIVO: SET, DEFINE, UNDEFINE, VARIABLE, PRINT y TIMING con un contexto inyectado (C10, C11).
ARCHIVOS: `app/src/sqlplusState.ts`, `app/src/sqlplusRun.ts` y sus tests (nuevos).
CONTEXTO:
- `SqlplusState`: `{settings:{linesize:80,pagesize:14,feedback,heading,timing,serveroutput}, defines:Map, vars:Map&lt;name,{type,value}&gt;, lastCreated?}`.
- `SqlplusCtx`: `{print(line,kind?), ask(name):Promise&lt;string|null&gt;, query(sql,binds?), readFile?, writeFile?, runScript?}`.
- `runSqlplus(cmd, state, ctx)`.
PASOS:
1. SET de LINESIZE, PAGESIZE, FEEDBACK, HEADING, TIMING y SERVEROUTPUT ON|OFF [SIZE n], con validación. Una opción desconocida imprime "Comando no admitido: SET X" completo.
2. DEFINE lista o asigna, y UNDEFINE borra.
3. `substituteDefines(sql, state, ask)`: `&amp;x` toma el define o pregunta con `ctx.ask`. Un null cancela.
4. VARIABLE solo con tipos que existan en `BindKind`. PRINT imprime una o todas.
5. `timingLine(ms)` devuelve "Transcurrido: 00:00:00.12".
6. Tests con contexto falso.
CRITERIO: [TS].
DEPENDE DE: 16.

BRIEF 26: SHOW USER, SHOW ERRORS y DESC (lecturas)
OBJETIVO: comandos de consulta, solo SELECT (C10).
ARCHIVOS: `app/src/sqlplusQueries.ts` (+test, nuevos), `app/src/sqlplusRun.ts`.
CONTEXTO: usar `ctx.query`, que ejecuta con `sqlExecute`. Antes de armar DESC, mirar lo que expone `api.ts` para el inspector (`ObjectInspector`).
PASOS:
1. `createdObject(sql)` detecta CREATE [OR REPLACE] PROCEDURE, FUNCTION, PACKAGE [BODY], TRIGGER o TYPE [BODY] y devuelve tipo y nombre.
2. `showErrorsQuery(obj)` consulta `ALL_ERRORS` (o `USER_ERRORS`) ordenado por secuencia.
3. `SHOW USER` con `SELECT SYS_CONTEXT('USERENV','SESSION_USER') FROM DUAL`.
4. `DESC` resuelve tipo con `ALL_OBJECTS`. Tablas y vistas leen `ALL_TAB_COLUMNS`. Rutinas y paquetes leen `ALL_ARGUMENTS`. Salida con `formatTable`.
5. Tests afirman que todo SQL generado empieza con `select` y que los valores van por binds.
CRITERIO: [TS].
DEPENDE DE: 20, 25.

BRIEF 27: @archivo y SPOOL
OBJETIVO: ejecutar scripts de archivo y volcar la salida (C12).
ARCHIVOS: `app/src/sqlplusRun.ts`, `app/src/sqlplusRun.test.ts`.
PASOS:
1. `@ruta`, `@@ruta` y `START`: `ctx.readFile`, luego `ctx.runScript(texto, {depth})`. Profundidad máxima 5 con mensaje claro. El eco muestra la ruta resuelta.
2. `SPOOL archivo` acumula lo que imprime `ctx.print` hasta `SPOOL OFF`, que escribe con `ctx.writeFile` y confirma "Salida guardada en &lt;ruta&gt;". `SPOOL` sin argumentos muestra el estado. Un segundo SPOOL cierra el anterior.
3. Errores de E/S en español.
4. Tests con contexto falso.
CRITERIO: [TS].
DEPENDE DE: 24, 25.

FASE 4: grilla

BRIEF 28: serialización de celdas (G6, G13 parte pura)
OBJETIVO: TSV y CSV sin romperse, encabezados, NULL, INSERT y BOM.
ARCHIVOS: `app/src/gridSelection.ts` (:3-8), `app/src/gridSelection.test.ts` (nuevo).
PASOS:
1. Una celda con `\t`, `\n`, `\r` o `"` se envuelve entre comillas con `""` escapado. `copyGridCells` mantiene su firma y suma `opts`.
2. `serializeCells(rows,{format, headers?, nullAs})`.
3. `parseTsv(text)` respeta las comillas (lo usa el pegado).
4. `copyAsInsert(table, columns, rows)`: identificadores con comillas solo si hace falta, `''` escapado, NULL, y TO_DATE o TO_TIMESTAMP para columnas de fecha.
5. `withBom(csv)`.
CRITERIO: [TS].
DEPENDE DE: ninguna.

BRIEF 29: navegación de la grilla (G4)
OBJETIVO: la celda activa siempre visible, con RePág y AvPág.
ARCHIVOS: `app/src/gridNav.ts` (+test, nuevos), `app/src/components/ResultGrid.tsx` (:78-82, :123-152), `ResultGrid.test.tsx`.
PASOS:
1. `moveCell(pos, key, {rows, cols, page})` puro con tests: flechas, Home y End de fila, Ctrl+Home y Ctrl+End, PageUp y PageDown.
2. `ResultGrid` hace scroll vertical siempre (hoy solo con más de 300 filas) y scroll horizontal respetando columnas fijas.
CRITERIO: [TS].
DEPENDE DE: ninguna.

BRIEF 30: selección de rango (G3)
OBJETIVO: Shift+clic, Ctrl+clic, arrastre y Shift+flechas.
ARCHIVOS: `app/src/gridNav.ts`, `app/src/components/ResultGrid.tsx` (:234-235), `ResultGrid.test.tsx`.
PASOS:
1. Modelo de selección como lista de rectángulos con ancla y foco. Tests: Shift+clic extiende, Ctrl+clic agrega, arrastre con mouse, Shift+flechas y Shift+PageUp extienden. Clic en el encabezado de fila o de columna selecciona toda la fila o columna cargada.
2. Estilo: fondo de token, sin bordes de color ni franjas. La celda activa con fondo más marcado.
3. Exportar `selectedCells()` para copiar.
CRITERIO: [TS].
DEPENDE DE: 29.

BRIEF 31: pegar en la grilla y Escape (G5)
OBJETIVO: pegar TSV en modo edición y que Escape no confirme.
ARCHIVOS: `app/src/components/ResultGrid.tsx` (:148, :243, :248), `ResultGrid.test.tsx`.
CONTEXTO: prop nueva `onPasteCells?(pos, matrix: string[][])`. Cablear en el brief 50.
PASOS:
1. En modo edición, `onPaste` usa `parseTsv` y envía la matriz desde la celda activa. Las columnas sobrantes se ignoran y avisa "Se pegaron N de M celdas" por `onNotice`. No crea filas.
2. En el input de edición, Escape cancela sin confirmar (bandera para que el `blur` posterior no confirme). Enter confirma. Tab confirma y avanza. El `blur` normal confirma.
CRITERIO: [TS].
DEPENDE DE: 28, 30.

BRIEF 32: ordenar y filtrar (G14)
OBJETIVO: orden por columna y filtro sobre las filas cargadas.
ARCHIVOS: `app/src/gridView.ts` (+test, nuevos), `app/src/components/ResultGrid.tsx`, `ResultGrid.test.tsx`, `app/src/components/SqlWindow.css`.
PASOS:
1. `viewIndexes(rows, columns, {sort, filters})` devuelve índices de origen. Orden numérico o de texto, con NULL al final. El filtro es "contiene", sin distinguir mayúsculas.
2. Encabezado con Enter o clic que cicla ascendente, descendente y ninguno (`aria-sort`, íconos Phosphor). Botón de filtros con fila de filtros.
3. Con `more` se avisa "Ordenado sobre N filas cargadas".
4. Deshabilitado en modo edición, porque los índices ligan las ediciones pendientes.
5. Selección y copia usan el mapeo hacia las filas de origen.
CRITERIO: [TS].
DEPENDE DE: 30.

BRIEF 33: totales parciales y tooltip (G15, G16)
OBJETIVO: marcar totales parciales y mostrar valores largos.
ARCHIVOS: `app/src/components/ResultGrid.tsx` (:100-104, :231-250), `app/src/components/SqlWindow.css` (:66), `ResultGrid.test.tsx`.
PASOS:
1. Con `more`, el total dice "parcial" ("Parcial, 50 filas cargadas").
2. `title` en las celdas recortadas, solo cuando hay overflow.
CRITERIO: [TS].
DEPENDE DE: 32.

BRIEF 34: visor de celda (G16)
OBJETIVO: ver el valor completo, incluidos CLOB largos.
ARCHIVOS: `app/src/components/CellViewer.tsx` (+css, nuevos), `app/src/components/ResultGrid.tsx`, `ResultGrid.test.tsx`.
PASOS:
1. Diálogo con el texto completo, Copiar y Cerrar. Trampa de foco con el patrón de `TransactionDialog.tsx:21-33`. Si el largo es igual al tope (brief 23), mostrar "Primeros 1.000.000 caracteres".
2. Abre con `viewCell` (Shift+Space, ya registrado en el brief 1) y con la opción del menú de la grilla (brief 49).
3. Columnas `lob` solo lectura en edición, con tooltip "Valor recortado".
CRITERIO: [TS].
DEPENDE DE: 23, 33.

FASE 5: consola

BRIEF 35: extraer la consola de SqlWindow
OBJETIVO: mover la consola a su propio componente, sin cambio de comportamiento.
ARCHIVOS: `app/src/components/CommandConsole.tsx` y `.css` (nuevos), `app/src/components/SqlWindow.tsx` (consola ~705-809, efectos :117-133, `runConsoleCommand` :232-255), `app/src/components/SqlWindow.css` (:3-10, mover las reglas de consola), `SqlWindow.test.tsx` (:73-94 debe seguir pasando).
CONTEXTO: contrato (`ConsoleIo.ask` queda como stub que devuelve null hasta el brief 40):
```
ConsoleLine{kind:"in"|"out"|"err"|"info",text}
ConsoleIo{ask(name):Promise&lt;string|null&gt;}
Props{lines,running,active,onRun(source,io):Promise&lt;void&gt;,onCancel(),onClear()}
```
`SqlWindow` conserva `run()`, `log()` y la ejecución.
PASOS:
1. Mover JSX, estado de entrada e historial a `CommandConsole`.
2. `SqlWindow` renderiza `&lt;CommandConsole&gt;` cuando hay `command`.
3. Los tests actuales de consola pasan sin cambios.
CRITERIO: [TS].
DEPENDE DE: ninguna.

BRIEF 36: una sola superficie de terminal (C1)
OBJETIVO: el prompt y la línea en edición forman parte del log.
ARCHIVOS: `app/src/components/CommandConsole.tsx` y `.css`, `SqlWindow.test.tsx`.
PASOS:
1. Prompt "SQL&gt;" y textarea como último hijo del `role="log"`. El textarea es transparente, de alto automático por `scrollHeight`, sin `.fld`, sin fondo en `focus-within` y sin borde de acento.
2. Foco visible: el cursor y el prompt en `--accent` (color, sin borde).
3. Tests: no existe `.fld`, el textarea es hijo del log, el alto crece con las líneas.
CRITERIO: [TS].
DEPENDE DE: 35.

BRIEF 37: foco y scroll de la consola (C2, C3)
OBJETIVO: foco consistente y scroll que no pelea con el usuario.
ARCHIVOS: `app/src/components/CommandConsole.tsx`, `SqlWindow.test.tsx`.
PASOS:
1. Clic en cualquier parte del terminal enfoca la línea, salvo que haya texto seleccionado.
2. Foco al montar, al activar la pestaña, al terminar un comando y al volver el foco a la ventana.
3. Scroll automático solo si el usuario estaba al fondo (umbral de 8 px).
4. Tests de cada caso.
CRITERIO: [TS].
DEPENDE DE: 36.

BRIEF 38: entrada multilínea e historial (C4)
OBJETIVO: continuación numerada, Shift+Enter e historial correcto.
ARCHIVOS: `app/src/components/CommandConsole.tsx`, `SqlWindow.test.tsx`.
PASOS:
1. Prompt de continuación numerado "  2  " estilo SQL*Plus.
2. Shift+Enter siempre inserta salto.
3. ↑ y ↓ recorren el historial solo con el cursor en la primera o última línea; si no, mueven el cursor.
4. Historial por sesión sin duplicados consecutivos.
5. No usar `trim()` sobre la sangría: solo para detectar vacío.
CRITERIO: [TS].
DEPENDE DE: 36.

BRIEF 39: escribir por adelantado y tiempo transcurrido (C14)
OBJETIVO: no bloquear la entrada mientras corre un comando.
ARCHIVOS: `app/src/components/CommandConsole.tsx`, `SqlWindow.test.tsx`.
PASOS:
1. El textarea ya no es `readOnly` durante la ejecución. Enter encola y se ejecuta en orden al terminar.
2. Mostrar "Ejecutando 3 s" con un contador por segundo.
3. Tests con timers falsos.
CRITERIO: [TS].
DEPENDE DE: 38.

BRIEF 40: pegar multilínea y modo pregunta (C5, C11)
OBJETIVO: pegar línea por línea e implementar `io.ask`.
ARCHIVOS: `app/src/components/CommandConsole.tsx`, `SqlWindow.test.tsx`.
PASOS:
1. Pegar varias líneas las procesa como si se tipearan, usando la cola del brief 39. Las sentencias completas se ejecutan en orden y lo incompleto queda en el buffer. Una sola línea se inserta normal.
2. `io.ask(name)`: el prompt pasa a "Ingrese valor para x:" y la siguiente entrada resuelve la promesa, sin historial ni ejecución. Escape resuelve con null.
3. Tests de ambos.
CRITERIO: [TS].
DEPENDE DE: 39.

BRIEF 41: Ctrl+C, Ctrl+L y Escape en la consola (C6)
OBJETIVO: atajos de terminal.
ARCHIVOS: `app/src/components/CommandConsole.tsx`, `SqlWindow.test.tsx`.
PASOS:
1. Ctrl+C con selección copia. Sin selección y con ejecución en curso, llama `onCancel`. La tecla se obtiene de `commands.copyGrid.keys`.
2. Ctrl+L llama `onClear` (usa `commands.clearConsole`, brief 1).
3. Escape sin entrada no hace nada.
4. Tests.
CRITERIO: [TS].
DEPENDE DE: 40.

FASE 6: SqlWindow

BRIEF 42: errores, salida y estado (G7, G8, G19, G20, C13)
OBJETIVO: errores con línea y columna, salida del bloque que falla, y registro sin copiar por línea.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:193-195, :310-313, :319, :408-410), `app/src/useLineBuffer.ts` (+test, nuevos), `SqlWindow.test.tsx`.
PASOS:
1. El error usa `locateError`: salta a línea y columna si las hay y, si no, no mueve el cursor. Muestra "Línea X, columna Y" en Salida.
2. El resultado `Failed` (brief 21) muestra primero el DBMS_OUTPUT y luego el error.
3. Commit y Rollback deshabilitados mientras `running`, `fetching` o `applying`.
4. `useLineBuffer(cap)` acumula en un `ref` y publica por lote (unos 100 ms), sin copiar el array por línea. Tope de 10000 en Salida y 2000 en la consola, con la línea "... N líneas anteriores omitidas".
5. La consola usa el mismo hook.
CRITERIO: [TS].
DEPENDE DE: 17, 21, 35.

BRIEF 43: variables del script y explain (G17)
OBJETIVO: el panel muestra las variables de todo el script y explain sustituye.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:178-182, :221-222, :263-270), `SqlWindow.test.tsx`.
PASOS:
1. El panel Variables lista las variables de todo el script (`findVariables`). F8 sobre una sentencia usa solo las suyas, y el panel marca cuáles se usan.
2. `explain()` aplica `applySubstitutions` igual que `run`.
CRITERIO: [TS].
DEPENDE DE: 18, 42.

BRIEF 44: SQL*Plus en ventana y consola (G10, C10, C12, C9 parcial)
OBJETIVO: dejar de omitir comandos SQL*Plus y ejecutarlos con el ejecutor común.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:232-255, :256-350), `SqlWindow.test.tsx`.
PASOS:
1. Un `SqlplusState` por ventana, en un `ref`.
2. Construir `SqlplusCtx`:
   - `print` va a `log` (consola o Salida).
   - `ask`: en la consola usa `io.ask`; en la ventana usa el panel Variables.
   - `query` usa `api.sqlExecute` en la sesión de la ventana, solo SELECT.
   - `readFile` y `writeFile` usan `api.readScriptFile` y `api.writeSpoolFile`.
   - `runScript` usa `run(splitScript(text))`.
3. Los `sqlplus` ya no se omiten. Los no soportados imprimen "Comando no admitido: SET SQLPROMPT" completo.
4. Después de cada sentencia correcta, registrar `createdObject` para `SHOW ERRORS`.
5. TIMING usa `elapsed_ms`. FEEDBACK usa `done_message`. SERVEROUTPUT OFF oculta la salida.
6. Tests con la API simulada.
CRITERIO: [TS].
DEPENDE DE: 16, 24, 25, 26, 27, 40, 42.

BRIEF 45: VAR y PRINT con binds (C11)
OBJETIVO: variables de enlace de la ventana y la consola.
ARCHIVOS: `app/src/components/SqlWindow.tsx`, `SqlWindow.test.tsx`.
PASOS:
1. Un `:x` declarado con VARIABLE viaja como bind con su valor. Verificar cómo se pasan los binds en `sqlExecute` y si el parámetro `outputs` (ventana de prueba) sirve para leer valores de salida de sentencias comunes.
2. PRINT muestra el valor devuelto por `outputs`. Si no se puede leer salida en esta ruta, queda como limitación documentada.
3. Un `:x` sin declarar pregunta (consola) o usa el panel (ventana). Ya no va como NULL en silencio (:293-295).
4. Tests.
CRITERIO: [TS].
DEPENDE DE: 44.
[PU]: OUT binds reales.

BRIEF 46: confirmación en producción (A17)
OBJETIVO: confirmar antes de ejecutar escritura en producción.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (`run`), `app/src/App.tsx` (prop `environment` si no existe, render ~:852), tests.
CONTEXTO: seguir el patrón de confirmación que ya usa Recompilar o Compilar en producción.
PASOS:
1. Si el entorno es producción y `needsConfirm` da escritura (DML, DDL, EXEC o PL/SQL), mostrar "Producción. ¿Ejecutar?" con Ejecutar y Cancelar. Aplica a ventana SQL y consola.
2. En scripts y `@archivo`, evaluar el texto completo y confirmar una sola vez.
3. Las lecturas no preguntan.
CRITERIO: [TS].
DEPENDE DE: 19, 44.

BRIEF 47: cambios pendientes de la grilla (G1)
OBJETIVO: no perder cambios sin aviso.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:272-273), `app/src/App.tsx` (:322-324, :577), tests.
PASOS:
1. `SqlWindow` expone `hasPending()` por el ref. `run()` con cambios pendientes pregunta "Hay N cambios sin aplicar. ¿Descartar?".
2. `closeProgram` y `onCloseRequested` consultan ese estado además de dirty y transacción.
3. Tests de cada ruta (F8, cerrar pestaña, cerrar app).
CRITERIO: [TS].
DEPENDE DE: 46.

BRIEF 48: copiar y exportar (G2, G13)
OBJETIVO: copiado honesto, con encabezados, INSERT y BOM.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:394-401), `app/src/components/ResultGrid.tsx` (:99, :112-121, :293-294), tests.
PASOS:
1. Con `more`, copiar o Ctrl+A avisa "Copiadas N filas cargadas; hay más" en la línea de estado.
2. Menú contextual de la grilla (nuevo, con `ContextMenu`): Copiar, Copiar con encabezados, Copiar como INSERT y Ver valor.
3. Exportar CSV con BOM y NULL vacío.
CRITERIO: [TS].
DEPENDE DE: 28, 34, 47.

BRIEF 49: pegar y editor en SqlWindow (G5, E10, G18)
OBJETIVO: conectar el pegado y F3.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:607-636), `SqlWindow.test.tsx`.
PASOS:
1. `onPasteCells` llama `editCell` por celda.
2. Agregar `findNext` y `findPrev` a las acciones del editor.
3. Verificar que Ctrl+Enter ejecuta (alias de `execute`).
4. Tests.
CRITERIO: [TS].
DEPENDE DE: 8, 31, 48.

BRIEF 50: consola sin atajos del editor (C7)
OBJETIVO: F8, F5, Ctrl+S, Ctrl+E y Ctrl+Shift+X sin efecto en consola.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:583-636), `app/src/App.tsx` (:292-300) si filtra ids, tests.
PASOS:
1. Cuando hay `command`, las acciones `execute`, `executeScript`, `explainPlan`, `save`, `editData` y `exportData` son `undefined`. Tests: Ctrl+S ya no guarda un archivo vacío y Ctrl+E no abre una grilla invisible.
2. Con T1, esas teclas pasan sin `preventDefault` ni acción.
CRITERIO: [TS].
DEPENDE DE: 49.

BRIEF 51: salida de la consola (C8, C9)
OBJETIVO: SELECT en texto tabular y errores completos.
ARCHIVOS: `app/src/components/SqlWindow.tsx` (:322-337, :248-253, :304-316), `SqlWindow.test.tsx`.
PASOS:
1. Un SELECT en consola usa `formatTable` con los `settings` (linesize, pagesize, heading). Trae hasta 500 filas en lotes y cierra el cursor. Termina con `feedbackLine`.
2. Si hay más: "Se muestran 500 filas. Hay más." (sin citar Ctrl+Shift+X).
3. Los errores usan `formatConsoleError` con código, mensaje, línea, columna y fragmento.
CRITERIO: [TS].
DEPENDE DE: 17, 20, 44, 50.

FASE 7: resto de App

BRIEF 52: avisos (A6, A20)
OBJETIVO: avisos que no se pisan y errores que no se pierden.
ARCHIVOS: `app/src/App.tsx` (:373-376, :1108-1112, :546), `app/src/components/StartupCheck.tsx` (:60-63), tests.
PASOS:
1. Un solo estado de aviso con el timer en un `ref` que se limpia al aparecer otro.
2. Un aviso informativo dura 2,5 s. Un error permanece hasta cerrarlo (botón Phosphor `X`), y un informativo posterior no lo reemplaza.
3. Los errores silenciosos de :546 y de `StartupCheck` pasan a mostrarse.
CRITERIO: [TS].
DEPENDE DE: 12.

BRIEF 53: arrastrar y soltar archivos (E7, A14)
OBJETIVO: abrir `.sql`, `.pks`, `.pkb` y `.tst` soltándolos, y arreglar el arrastre de texto.
ARCHIVOS: `app/src-tauri/tauri.conf.json` (`dragDropEnabled: false` en la ventana), `app/src/App.tsx`, tests.
PASOS:
1. Extraer `openFileContent(name, source)` de `openProgram`.
2. Manejador `drop` global: actúa solo si `dataTransfer.types` incluye "Files". `file.text()` y el mismo flujo de apertura. Tipos no admitidos: aviso "Tipo no admitido: x.zip".
3. El arrastre de texto dentro del editor no se toca.
CRITERIO: [TS].
DEPENDE DE: 52.
[PU]: arrastre real en Windows.

BRIEF 54: pestañas (A15)
OBJETIVO: Ctrl+Tab y reordenar pestañas.
ARCHIVOS: `app/src/tabs.ts` (+test, nuevos), `app/src/App.tsx` (:968-985), `App.test.tsx`.
PASOS:
1. `reorder(list, from, to)` y `neighbor(list, index, delta)` con vuelta circular, con tests.
2. Acciones `nextTab` y `prevTab` (Ctrl+Tab y Ctrl+Shift+Tab), y `moveTabLeft` y `moveTabRight`.
3. Arrastre HTML5 de pestañas (requiere el brief 53).
4. Al cambiar de pestaña, el foco va al editor (brief 6).
CRITERIO: [TS].
DEPENDE DE: 1, 53.

BRIEF 55: almacén de espacio de trabajo (A13, núcleo)
OBJETIVO: persistir las pestañas por perfil.
ARCHIVOS: `crates/openpl-core/src/workspace.rs` (nuevo), `crates/openpl-core/src/lib.rs`.
CONTEXTO: seguir el patrón de `profiles.rs` (JSON, escritura atómica).
PASOS:
1. `Workspace{version:1, tabs}` con `TabState::{Object{object_type,owner,name}, Sql{title,text,kind}, File{name,text}}`.
2. `WorkspaceStore::new(dir)` con `load(profile_id)`, `save(profile_id, &amp;Workspace)` y `clear(profile_id)`.
3. Topes: 50 pestañas y 2 MiB de texto en total.
4. Tests con directorio temporal: ida y vuelta, versión desconocida, tope y `clear`.
CRITERIO: [RS].
DEPENDE DE: ninguna.

BRIEF 56: IPC del espacio de trabajo
OBJETIVO: exponer el almacén.
ARCHIVOS: `app/src-tauri/src/state.rs`, `app/src-tauri/src/commands.rs`, `app/src-tauri/src/lib.rs`, `app/src/api.ts`, `app/src/types.ts`.
PASOS:
1. Comandos `load_workspace`, `save_workspace` y `clear_workspace`, con `*_impl` testeables y su registro.
2. Envoltorios y tipos espejo (`WorkspaceTab` y demás).
CRITERIO: [RS] y [TS].
DEPENDE DE: 55.

BRIEF 57 [PU]: restaurar pestañas (A13)
OBJETIVO: guardar y ofrecer restaurar las pestañas.
ARCHIVOS: `app/src/workspace.ts` (+test, nuevos), `app/src/App.tsx`, `App.test.tsx`.
PASOS:
1. `captureWorkspace(tabs)` y `validateWorkspace(json)` puros. Incluyen objetos (solo tipo, esquema y nombre) y texto de ventanas SQL y de prueba. Los archivos locales van como borrador con nombre y texto. No incluyen consolas, historial ni claves.
2. Guardado con debounce de 2 s mientras haya conexión con perfil guardado, y vaciado al cerrar.
3. Tras conectar con el mismo perfil, si hay pestañas guardadas, franja "Restaurar N pestañas" con Restaurar y Descartar. Descartar borra el espacio.
4. Restaurar abre los objetos (solo lectura desde Oracle) y las ventanas SQL con su texto, sin ejecutar.
CRITERIO: [TS].
DEPENDE DE: 54, 56.
[PU]: cerrar y reabrir con un perfil real.

BRIEF 58: trampa de foco y Escape (A16, E14 ContextMenu)
OBJETIVO: diálogos accesibles y el foco devuelto a quien lo abrió.
ARCHIVOS: `app/src/useFocusTrap.ts` (+test, nuevos), `app/src/components/LoginDialog.tsx` (:181), `app/src/components/ThemeDialog.tsx` (:213), `app/src/components/ContextMenu.tsx` (:31-49, :63-71).
CONTEXTO: patrón en `TransactionDialog.tsx:21-33`.
PASOS:
1. El hook cicla Tab y Shift+Tab, cierra con Escape y devuelve el foco al elemento previo. Test.
2. `LoginDialog` y `ThemeDialog` lo usan.
3. En `ContextMenu`, Tab cierra el menú y devuelve el foco a quien lo abrió. El clic fuera también lo restaura, al editor si venía de allí.
CRITERIO: [TS].
NO TOCAR: `TransactionDialog.tsx`.
DEPENDE DE: 13.

BRIEF 59: barra de menús con teclado (A9, A19)
OBJETIVO: Alt abre la barra, y ← → cambian de menú.
ARCHIVOS: `app/src/components/MenuBar.tsx` (:60-65, :71-79, :88), `MenuBar.test.tsx`.
PASOS:
1. Alt solo (`keydown` y `keyup` sin otra tecla) enfoca la barra y abre el primer menú. Con otra tecla no actúa, para no chocar con Alt+S, Alt+B y similares.
2. ← y → cambian de menú abierto. ↑ y ↓ ya existen.
3. Los deshabilitados dicen el motivo en `title`.
CRITERIO: [TS].
DEPENDE DE: ninguna.

FASE 8: documentación y cierre

BRIEF 60: documentación y auditoría antislop
OBJETIVO: dejar constancia y el informe PASS/FAIL.
ARCHIVOS: `docs/ESTADO.md`, `docs/behavior/{programa,sql,comandos,conexion,explorador}.md`, `DESIGN.md` solo si cambió una regla, `anti-slop/audit-auditoria-ux-2026-11-24.md` (nuevo).
PASOS:
1. ESTADO: sección de la rama con lo hecho, las decisiones, las teclas cambiadas (Ctrl+R pasa a Reemplazar, refrescar pasa a Ctrl+Shift+R), las limitaciones y la siguiente tarea.
2. Limitaciones a registrar: anchos de columna no persistidos, CONNECT fuera, tope de LOB, archivos locales sin ruta.
3. Consolidar las PRUEBAS DEL USUARIO (lista al final) y las verificaciones corridas.
4. Cada nota de comportamiento con palabras propias (clean-room) y sin datos reales.
5. Informe PASS/FAIL de antislop por área, con foco, contraste, estados y selección sin borde de color.
CRITERIO: revisión de enlaces; [TS] y [RS] sin cambios.
NO TOCAR: código.
DEPENDE DE: 1 a 59.

BRIEF 61: cierre de rama
OBJETIVO: verificar y dejar la rama lista, sin integrar.
ARCHIVOS: ninguno.
PASOS:
1. Correr [RS] y [TS] completos. Si `App.test.tsx` falla de forma intermitente, repetir una vez y anotarlo.
2. `git status` limpio y `git log main..feat/auditoria-ux --oneline` revisado, sin datos reales en el diff.
3. NO hacer merge, push ni PR (AGENTS.md "Flujo de ramas").
4. Reportar al usuario: rama, resultados de los comandos y PRUEBAS DEL USUARIO pendientes. Preguntar si quiere integrar.
5. Solo si el usuario lo pide expresamente: `git switch main; git pull --ff-only; git merge --no-ff feat/auditoria-ux; git push origin main`, sin reescribir historia.
CRITERIO: los cinco comandos en verde.
DEPENDE DE: 60.

PRUEBAS DEL USUARIO (consolidadas)
- Brief 2: tamaño y posición recordados; Pegar desde el menú.
- Brief 7: fluidez con un paquete grande.
- Brief 9: timeout con un host inalcanzable, nunca contra DESA.
- Briefs 21, 22 y 23: DBMS_OUTPUT de un bloque que falla, fechas y TIMESTAMP WITH TIME ZONE al ver y editar, y CLOB grande, todo contra una base de pruebas con escritura.
- Brief 45: OUT binds y PRINT.
- Brief 53: arrastre de archivos en Windows.
- Brief 57: restaurar pestañas con un perfil real.
- Recorrido visual: consola, grilla (rango, orden, filtro), menús, Alt, foco de diálogos.

Cantidades: 61 briefs, 3 con dependencias nuevas (2 en el brief 2, más features de tokio en el brief 9).
