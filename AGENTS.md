# Instrucciones para agentes (y personas) que trabajen en OpenPL

Lee esto completo antes de tocar código. Después lee [docs/ESTADO.md](docs/ESTADO.md): dice qué
está hecho, qué decisiones cambiaron el diseño y qué sigue.

## Qué es

OpenPL es un IDE de escritorio open source para Oracle PL/SQL, alternativa libre a PL/SQL
Developer. Rust (núcleo) + Tauri v2 + React/TypeScript (interfaz). Windows y Linux.

- Diseño (fuente de verdad del producto): [docs/superpowers/specs/2026-11-23-openpl-design.md](docs/superpowers/specs/2026-11-23-openpl-design.md)
- Estado, decisiones posteriores y próximos pasos: [docs/ESTADO.md](docs/ESTADO.md)
- Comportamiento observado de la herramienta de referencia: [docs/behavior/](docs/behavior/)
- Logo y colores: [design/logo/README.md](design/logo/README.md)

Si el diseño y `docs/ESTADO.md` se contradicen, manda `docs/ESTADO.md` (registra decisiones más nuevas).

## Reglas que no se negocian

1. **Clean-room.** Nunca descompilar, desensamblar ni copiar código, íconos, textos o manuales de
   PL/SQL Developer. Se permite observar su comportamiento usándolo normalmente y describirlo con
   palabras propias en `docs/behavior/`. No usar su marca en la interfaz.
2. **Sin datos reales.** Ningún nombre de usuario, esquema, base, host o contraseña real en código,
   tests, docs, commits ni mockups. Ejemplos permitidos: usuario `HR`, perfil `HR en DEV`,
   `db.example.com:1521/DEVPDB`, paquetes `PKG_VENTAS`, alias `ORCL`.
3. **Oracle:** ver la sección "Base de desarrollo: solo lectura".
4. **Contraseñas** solo en el almacén seguro del sistema (`keyring`) y solo si el usuario marca
   "Guardar contraseña". Nunca en archivos, logs, `Debug` ni mensajes de error.
5. **TDD.** Primero el test, verlo fallar por la razón correcta, después el código mínimo, después
   la suite completa en verde. Un arreglo sin un test que falló antes no está verificado.
6. **Interfaz:** textos cortos en español, sin frases explicativas en pantalla. Tema grafito por
   defecto, con temas predefinidos y propios (`app/src/themes.ts`); todo color nuevo es un token
   con valor en cada tema (o derivado en `themes.ts`), salvo los de entorno, que son fijos. Íconos Phosphor, IBM Plex Sans/Mono, componentes rectos estilo Zed (ver "Interfaz" abajo).
   Toda interfaz nueva lee primero [DESIGN.md](DESIGN.md) (dirección) y aplica antislop como
   filtro mientras se construye (skills `antislop`, `antislop-ui`, `antislop-human` y
   `antislop-code`): contraste medido, estados de carga/vacío/error, foco visible, nada sin acción.
   Cada entrega con interfaz cierra con el informe PASS/FAIL de antislop. Auditorías en `anti-slop/`.
7. **Todo comando importante tiene atajo visible**, registrado en `app/src/keymap.ts`. Nunca
   definir un atajo en otro lado.
8. Oracle **12.1** o superior; Instant Client **19 o 21** recomendado. Nada que dependa de 12.2+
   o 18c+ sin comprobar la versión del servidor.
9. Sin telemetría ni llamadas de red salvo a la base de datos.
10. Licencia `Apache-2.0 OR MIT`; toda dependencia debe ser compatible.

## Preparar el entorno

**Windows**
- Rust stable (`rustup`, toolchain `x86_64-pc-windows-msvc`).
- Visual Studio Build Tools / Community con la carga "Desarrollo para el escritorio con C++".
- Node.js 22+.
- Oracle Instant Client 19 o 21 de 64 bits en el `PATH` (un cliente Oracle completo 12.1 también
  funciona; la app muestra "cliente no probado").
- En PowerShell con la política de ejecución restringida, usar `npm.cmd` / `npx.cmd` en vez de
  `npm` / `npx`.

**Linux**: `build-essential libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libsecret-1-dev
libaio1`, Rust, Node, Instant Client en `LD_LIBRARY_PATH`.

## Comandos

Desde la raíz del repo:

```
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Desde `app/`:

```
npm.cmd install          # una vez
npx.cmd tsc --noEmit
npm.cmd test             # vitest
npm.cmd run tauri dev    # abrir la app en desarrollo (recarga sola)
npm.cmd run tauri build -- --debug --no-bundle
```

Pruebas contra una base real (opcionales, solo lectura): definir `OPENPL_TEST_USER`,
`OPENPL_TEST_PASSWORD` y `OPENPL_TEST_DB` (alias o `host:puerto/servicio`). Sin ellas, las pruebas
`live` imprimen `SKIP` y pasan.

Antes de dar algo por terminado: las tres de Rust y las dos de `app/` en verde, sin advertencias.

## Mapa del código

```
crates/openpl-oracle/   acceso a Oracle (crate `oracle` 0.6 / ODPI-C)
  version.rs            DbVersion, Compat, check_compat (reglas cliente/servidor)
  error.rs              DbError, ErrorKind, classify (códigos ORA/DPI → categorías)
  client.rs             init_client, client_version, client_help
  connect.rs            ConnectParams (Debug oculta la clave), DbConn
crates/openpl-core/     lógica sin interfaz
  profiles.rs           ConnectionProfile, Environment, ProfileStore (JSON sin contraseñas)
  secrets.rs            SecretStore, KeyringStore, MemoryStore
  session.rs            Session (un hilo por conexión), SessionManager, Connector (+ fake)
  catalog.rs            ObjectType (35 tipos), objects_query, fallback_query, list_objects
  actions.rs            get_ddl (DBMS_METADATA), recompile
  program.rs            carga de fuentes y diagnósticos del diccionario
app/src-tauri/src/      Tauri: state.rs (AppState, AppSettings), commands.rs (IPC), lib.rs (run)
app/src/
  api.ts / types.ts     envoltorios tipados de los comandos y tipos espejo de Rust
  keymap.ts             registro único de comandos y atajos (+ handleShortcut)
  theme.css             tokens del tema grafito, botones, menús
  themes.ts             temas predefinidos y propios (localStorage), avisos de contraste
  contrast.ts           razón de contraste WCAG 2.x
  objectMenu.ts         menú contextual del explorador por tipo de objeto
  programScript.ts      sentencia de compilación (F8) a partir del editor
  programCompletion.ts  contexto del cursor y fuentes de completado
  App.tsx               barra de título (menús, Nuevo, conexión, transacción, Sol/Luna), layout
  components/           StartupCheck, LoginDialog, ConnectionBar, MenuBar, ObjectBrowser,
                        ContextMenu, Logo, ProgramWindow, ProgramEditor, EditorSearch,
                        SqlWindow, ResultGrid, ThemeDialog
docs/                   diseño, planes, notas de comportamiento, estado
design/logo/            logo maestro, variantes y guía
.github/workflows/ci.yml
```

## Base de desarrollo: solo lectura (regla estricta)

**Está PROHIBIDO en la base de desarrollo todo lo que no sea lectura.** Incluye compilar. Esta regla manda sobre cualquier otra instrucción de este archivo y sobre cualquier brief.

- **Permitido:** solo sentencias `SELECT`, incluidas las consultas a vistas del diccionario y a `DUAL`.
- **Prohibido, sin excepción:**
  - DML: `INSERT`, `UPDATE`, `DELETE`, `MERGE`.
  - DDL: `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `COMMENT`, `GRANT`, `REVOKE`.
  - Compilar objetos en la base: `ALTER ... COMPILE`, `CREATE OR REPLACE`, el botón Recompilar.
  - `COMMIT` y `ROLLBACK`.
  - Bloques PL/SQL anónimos (`BEGIN ... END`, `DECLARE`) y llamadas a procedimientos o funciones de la base.
- **Los agentes no escriben ni compilan en la base de desarrollo, nunca.** Si una prueba necesita eso, no se ejecuta: se marca como "prueba del usuario". Esas pruebas las hace el usuario.
- Compilar el código de la app (`cargo build`, `cargo test`, `npm`) sigue permitido. La compilación de objetos Oracle queda fuera de las tareas del agente.
- **Producción:** nunca, bajo ningún motivo.
- **Datos de conexión:** host, puerto, servicio, usuario y contraseña no se escriben en ningún archivo del repo (código, tests, docs, commits o mensajes de commit). Las pruebas los leen de `OPENPL_TEST_USER`, `OPENPL_TEST_PASSWORD` y `OPENPL_TEST_DB`, que el usuario configura en su máquina.
- Un test que se activa con esas variables tiene que usar solo `SELECT`. Si no cumple, se corrige o se marca antes de correrlo contra la base de desarrollo.
- No se corren pruebas que hagan logins fallidos contra la base de desarrollo: pueden bloquear la cuenta de prueba.
- Todo brief que toque la base repite esta regla.

## Cómo hacer los cambios típicos

- **Nuevo comando IPC:** función en `openpl-core` con tests → `#[tauri::command]` en
  `app/src-tauri/src/commands.rs` (lógica en un `*_impl` testeable con `FakeConnector` si se
  puede) → registrarlo en `lib.rs` → envoltorio en `app/src/api.ts` (Tauri pasa los parámetros
  `snake_case` como `camelCase`) → tipos en `types.ts`.
- **Nuevo tipo de objeto del explorador:** variante en `ObjectType` (`catalog.rs`) y en `ALL`;
  tipos de `ALL_OBJECTS` en `oracle_types` o consulta propia en `custom`; DDL en `actions.rs`;
  en el frontend, `types.ts` y la lista `TYPES` de `ObjectBrowser.tsx` (etiqueta, ícono Phosphor,
  color por familia).
- **Nuevo atajo:** solo en `keymap.ts` (el test verifica que no haya repetidos). Mostrarlo en el
  menú, en el botón (`.kbd`) o en el tooltip.
- **Nueva opción de menú contextual:** `objectMenu` / `typeMenu` en `ObjectBrowser.tsx`. Si la
  ventana que la usa aún no existe, dejarla visible y deshabilitada (sin `run`).
- **Errores Oracle nuevos:** clasificarlos en `error.rs::classify` con test.

## Interfaz

- Dirección y motivos de cada decisión: [DESIGN.md](DESIGN.md).
- Tokens en `app/src/theme.css` (`--s0..--s3`, `--line`, `--text`, `--muted`, `--accent` ocre
  `#C99A3B`, `--env-dev/qa/prod`, colores de sintaxis). No usar colores sueltos. Un token editable
  nuevo va en `THEME_TOKENS` con valor en cada tema de `app/src/themes.ts` (el test compara
  Grafito con `theme.css`); los derivados (selección, línea activa, sombras) se calculan ahí.
- Componentes rectos: paneles y pestañas separados por líneas de 1 px, botones con radio 4 px,
  filas de 24 px. El color del entorno de la conexión va como franja en la conexión y en el borde
  superior de las pestañas.
- Íconos: `@phosphor-icons/react`, peso regular. El logo propio: componente `Logo`.

## Flujo de trabajo

1. Leer `docs/ESTADO.md` y la sección del diseño que toca.
2. Si es un bloque grande (una ventana nueva), escribir primero un plan en
   `docs/superpowers/plans/AAAA-MM-DD-openpl-NN-<tema>.md` con el mismo formato que el plan 1:
   restricciones globales, foco de revisión, tareas con archivos, interfaces exactas, tests y
   comandos de verificación.
3. Antes de implementar una pantalla nueva, escribir su nota en `docs/behavior/`.
4. Trabajar en una rama (`feat/...`), commits pequeños en español:
   `feat(app): ...`, `fix(core): ...`, `docs: ...`.
5. Al cerrar cada bloque o dejar trabajo en curso, actualizar `docs/ESTADO.md` con el plan activo,
   qué se hizo, decisiones, verificaciones ejecutadas, limitaciones y la siguiente tarea concreta.
   Enlazar las notas de comportamiento y el plan desde el estado para que otro agente pueda continuar.

## Flujo de ramas

- Cada feature nueva va en una rama nueva creada desde `main` actualizado (`git pull` antes),
  con nombre `feat/<tema>`.
- Al terminar, se integra a `main` con merge (sin reescribir historia) y se hace push.
- No se trabaja directo en `main`.

## No hacer

- No hacer `push`, merge a `main` ni publicar nada sin pedido explícito.
- No subir versiones mayores de dependencias sin motivo.
- No bajar el nivel de los tests (no saltear, no `.skip`, no borrar asserts para que pasen).
- No agregar textos explicativos en la interfaz.
