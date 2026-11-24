# OpenPL Plan 1 — Base, conexión y explorador de objetos

> **Estado: terminado** (rama `feat/plan-1-base`). Ver [docs/ESTADO.md](../../ESTADO.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una app de escritorio Tauri que detecta el Instant Client, guarda perfiles de conexión, conecta a Oracle 12.1+ verificando compatibilidad cliente/servidor, y muestra el explorador de objetos del esquema.

**Architecture:** Workspace Cargo con tres crates: `openpl-oracle` (adaptador sobre el crate `oracle`), `openpl-core` (perfiles, catálogo, sesiones en hilo propio; sin Tauri) y `openpl-app` (Tauri v2, comandos IPC). Frontend React + TypeScript + Vite en `app/`. Toda operación de BD corre en el hilo de su sesión; la interfaz nunca se bloquea.

**Tech Stack:** Rust stable (edición 2021), `oracle` 0.6, `tokio`, `serde`, `keyring` 3, `uuid`, `thiserror`, Tauri v2, React 18, TypeScript, Vite, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-23-openpl-design.md` (secciones 2, 4, 6, 7.1, 7.2, 7.3, 8)

**Planes siguientes (fuera de este):** 2) Ventana de programa · 3) Ventana SQL y grilla · 4) Ventana de prueba · 5) Empaquetado.

## Global Constraints

- Licencia: `Apache-2.0 OR MIT` en todos los `Cargo.toml` y `package.json`; archivos `LICENSE-APACHE` y `LICENSE-MIT` en la raíz.
- Oracle servidor mínimo **12.1**; Instant Client soportado **19 o 21**; Instant Client 23 no conecta a servidores < 19.
- Plataformas: Windows 10+ x64 y Linux x64.
- Clean-room: nada copiado de PL/SQL Developer (código, iconos, textos, manual); no usar su marca en la interfaz.
- Nunca guardar contraseñas en archivos: solo en el almacén seguro del sistema (`keyring`) y solo si el usuario marca "Guardar contraseña".
- Sin telemetría ni llamadas de red salvo a la base de datos.
- Textos de interfaz en español, cortos, sin frases explicativas en pantalla.
- Diseño visual: seguir el mockup referencia privada (página "v2 · grafito"). Tema grafito como único tema en v1, con estos tokens en `app/src/theme.css` como variables CSS: `--s0 #212327`, `--s1 #282A2F`, `--s2 #34373D`, `--s3 #3D4047`, `--line #17191C`, `--line2 #3A3D43`, `--text #DAD5CC`, `--muted #A39E95`, `--faint #6E6B66`, `--accent #C99A3B`, `--accentText #1E1A12`, `--accentSoft #3D3524`, `--err #E5786C`, `--errSoft #45292A`, `--ok #75C08E`, `--okSoft #263A2D`, `--env-dev #75C08E`, `--env-qa #D9A441`, `--env-prod #E5786C`, `--kw #8DB2CB`, `--ty #D6B27A`, `--st #A7C08E`, `--nu #DA8F6E`, `--cm #7E7A72`, `--fn #C7A2D9`.
- Tipografía: IBM Plex Sans (interfaz) e IBM Plex Mono (código), empaquetadas con la app (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), sin cargar nada de internet.
- Íconos: Phosphor vía `@phosphor-icons/react` (MIT), peso `regular`.
- Atajos: todo comando importante tiene atajo visible (menú, `kbd` en botones principales, tooltip en botones de ícono), según el mapa de la sección 7.7 del diseño. En este plan: barra de menús en la barra de título (Archivo, Editar, Buscar, Ver, Sesión, Herramientas, Ayuda) con los ítems de este plan habilitados (Conectar Ctrl Shift L, Desconectar, Reconectar, Mostrar/ocultar explorador Ctrl B, Refrescar explorador Ctrl R) y el resto deshabilitado; un registro central `app/src/keymap.ts` con `{ id, label, keys }` que usan menús, tooltips y manejador de teclado.
- Componentes estilo Zed: paneles y pestañas rectos separados por líneas de 1 px, botones con radio 4 px, filas de 24 px; el color del entorno aparece como franja en la conexión y en el borde superior de cada pestaña.
- Dependencias Rust y npm con licencias compatibles con Apache-2.0/MIT.

## Review Focus

1. **Instant Client ausente, de 32 bits o mal configurado** (DPI-1047): la app arranca igual, muestra qué falta y cómo configurarlo por sistema operativo, sin cerrarse → test en Task 2.
2. **Errores de login comunes** (ORA-01017 clave errónea, ORA-28001 clave expirada, ORA-12154 alias TNS inexistente, ORA-12541 sin listener): mensaje con código ORA y texto en español, el diálogo sigue abierto con los datos → test en Task 2.
3. **Conexión caída** (ORA-03113, ORA-03114, DPI-1080, ORA-02396 por inactividad): la sesión pasa a "desconectada" y se ofrece reconectar, en vez de errores repetidos → test en Task 5.
4. **Filtro del explorador con `_` o `%`** (nombres como `PKG_VENTAS`): el filtro es "contiene" literal, sin comodines involuntarios → test en Task 4.
5. **Esquemas con miles de objetos** o con nombres en minúsculas/entre comillas: carga por tipo bajo demanda, nombres mostrados tal cual están en el diccionario → test en Task 4.

## Estructura de archivos

```
Cargo.toml                          workspace
LICENSE-APACHE, LICENSE-MIT, README.md
crates/openpl-oracle/src/
  lib.rs        reexports
  version.rs    DbVersion, Compat, check_compat
  error.rs      DbError, ErrorKind, classify
  client.rs     client_version, ClientError, client_help
  connect.rs    Role, ConnectParams, DbConn
crates/openpl-oracle/tests/live.rs  integración (requiere OPENPL_TEST_*)
crates/openpl-core/src/
  lib.rs
  profiles.rs   ConnectionProfile, ProfileStore
  secrets.rs    SecretStore trait, KeyringStore, MemoryStore
  catalog.rs    ObjectType, ObjectStatus, ObjectInfo, Scope, objects_query, merge_status, list_objects
  session.rs    SessionId, SessionState, Session, SessionManager
crates/openpl-core/tests/live_catalog.rs
app/                                frontend (Vite + React)
  package.json, vite.config.ts, tsconfig.json, index.html
  src/main.tsx, src/App.tsx
  src/api.ts                       wrappers tipados de invoke()
  src/types.ts                     tipos espejo de los structs Rust
  src/components/StartupCheck.tsx
  src/components/LoginDialog.tsx
  src/components/ConnectionBar.tsx
  src/components/ObjectBrowser.tsx
  src/**/*.test.tsx
app/src-tauri/                      crate openpl-app
  Cargo.toml, tauri.conf.json, build.rs
  src/main.rs, src/commands.rs, src/state.rs
docs/behavior/conexion.md, docs/behavior/explorador.md
.github/workflows/ci.yml
```

## Variables de entorno de pruebas de integración

`OPENPL_TEST_USER`, `OPENPL_TEST_PASSWORD`, `OPENPL_TEST_DB` (alias o EZConnect). Si falta alguna, cada test de integración imprime `SKIP: OPENPL_TEST_* no definidas` y retorna sin fallar. Las pruebas de este plan **solo leen** (consultas al diccionario; la versión del servidor sale de ODPI, sin consultar `v$` que requiere privilegios).

---

### Task 1: Workspace y reglas de compatibilidad de versiones

**Files:**
- Create: `Cargo.toml`, `LICENSE-APACHE`, `LICENSE-MIT`, `README.md`, `.gitignore`
- Create: `crates/openpl-oracle/Cargo.toml`, `crates/openpl-oracle/src/lib.rs`, `crates/openpl-oracle/src/version.rs`

**Interfaces:**
- Produces:
  - `#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)] pub struct DbVersion { pub major: u32, pub minor: u32, pub update: u32 }` con `DbVersion::new(major, minor, update)` y `Display` → `"19.3.0"`.
  - `#[derive(Debug, Clone, PartialEq, Serialize)] #[serde(tag = "kind", content = "reason")] pub enum Compat { Supported, Warn(String), Unsupported(String) }`
  - `pub fn check_compat(client: DbVersion, server: DbVersion) -> Compat`

- [ ] **Step 1: Prerrequisitos de la máquina**

Instalar rustup (toolchain `stable-x86_64-pc-windows-msvc`) y Visual Studio Build Tools con "Desarrollo de escritorio con C++". En Linux: `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`, `libsecret-1-dev`. Instant Client 19 o 21 (Basic o Basic Light) en el `PATH` / `LD_LIBRARY_PATH`.
Run: `cargo --version && rustc --version`
Expected: versiones impresas sin error.

- [ ] **Step 2: Crear workspace**

`Cargo.toml` raíz con `members = ["crates/openpl-oracle", "crates/openpl-core", "app/src-tauri"]` (los dos últimos se crean en tareas posteriores; mientras tanto dejar solo los existentes), `resolver = "2"`, `[workspace.package] license = "Apache-2.0 OR MIT"`, `edition = "2021"`. Textos estándar de las licencias Apache-2.0 y MIT. `.gitignore`: `target/`, `node_modules/`, `app/dist/`.

- [ ] **Step 3: Escribir tests que fallan en `version.rs`**

```rust
#[test] fn ic19_con_12_1_soportado() {
    assert_eq!(check_compat(DbVersion::new(19,3,0), DbVersion::new(12,1,0)), Compat::Supported);
}
#[test] fn ic21_con_19_soportado() {
    assert_eq!(check_compat(DbVersion::new(21,13,0), DbVersion::new(19,0,0)), Compat::Supported);
}
#[test] fn servidor_11g_no_soportado() {
    assert!(matches!(check_compat(DbVersion::new(19,3,0), DbVersion::new(11,2,0)), Compat::Unsupported(_)));
}
#[test] fn ic23_con_servidor_12c_no_soportado() {
    let c = check_compat(DbVersion::new(23,4,0), DbVersion::new(12,2,0));
    assert_eq!(c, Compat::Unsupported(
        "Instant Client 23 no puede conectar a Oracle 12.2.0. Instale Instant Client 19 o 21.".into()));
}
#[test] fn ic23_con_servidor_19_advertencia() {
    assert!(matches!(check_compat(DbVersion::new(23,4,0), DbVersion::new(19,0,0)), Compat::Warn(_)));
}
#[test] fn cliente_12_1_advertencia() {
    assert!(matches!(check_compat(DbVersion::new(12,1,0), DbVersion::new(12,1,0)), Compat::Warn(_)));
}
#[test] fn display_version() { assert_eq!(DbVersion::new(19,3,0).to_string(), "19.3.0"); }
```

- [ ] **Step 4: Verificar que fallan**

Run: `cargo test -p openpl-oracle version`
Expected: FAIL de compilación (`check_compat` no existe).

- [ ] **Step 5: Implementar `check_compat`**

Reglas, en este orden:
1. servidor < 12.1 → `Unsupported("OpenPL requiere Oracle 12.1 o superior; el servidor es {server}.")`
2. cliente ≥ 23 y servidor < 19 → `Unsupported("Instant Client {client.major} no puede conectar a Oracle {server}. Instale Instant Client 19 o 21.")`
3. cliente 19..=21 → `Supported`
4. resto → `Warn("Instant Client {client.major} no está probado con OpenPL; se recomienda 19 o 21.")`

- [ ] **Step 6: Verificar que pasan**

Run: `cargo test -p openpl-oracle version`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml LICENSE-APACHE LICENSE-MIT README.md .gitignore crates/openpl-oracle
git commit -m "feat(oracle): workspace y reglas de compatibilidad cliente/servidor"
```

---

### Task 2: Errores, detección del cliente y conexión

**Files:**
- Create: `crates/openpl-oracle/src/error.rs`, `crates/openpl-oracle/src/client.rs`, `crates/openpl-oracle/src/connect.rs`
- Modify: `crates/openpl-oracle/src/lib.rs`, `crates/openpl-oracle/Cargo.toml` (agregar `oracle = "0.6"`, `serde`, `thiserror`)
- Test: tests unitarios en cada módulo; `crates/openpl-oracle/tests/live.rs`

**Interfaces:**
- Consumes: `DbVersion`, `Compat`, `check_compat` (Task 1).
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] pub enum ErrorKind { ClientMissing, InvalidCredentials, PasswordExpired, UnknownService, ConnectionLost, Other }`
  - `#[derive(Debug, Clone, Serialize, thiserror::Error)] #[error("{message}")] pub struct DbError { pub code: Option<String>, pub kind: ErrorKind, pub message: String }` — `code` como `"ORA-01017"` o `"DPI-1047"`.
  - `pub fn classify(code: &str) -> ErrorKind`
  - `impl From<oracle::Error> for DbError`
  - `pub fn init_client(lib_dir: Option<&std::path::Path>) -> Result<(), DbError>` — llamada una vez al arrancar, antes de cualquier otro uso; con `Some(dir)` usa `oracle::InitParams::new().oracle_client_lib_dir(dir)?.init()` (spec §4: "ruta en preferencias"); con `None` deja la búsqueda por `PATH`/`LD_LIBRARY_PATH`.
  - `pub fn client_version() -> Result<DbVersion, DbError>`
  - `pub fn client_help() -> &'static str` — texto según `cfg!(windows)`.
  - `#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)] pub enum Role { Normal, SysDba, SysOper }`
  - `#[derive(Clone, Deserialize)] pub struct ConnectParams { pub user: String, pub password: String, pub db: String, pub role: Role }` — `Debug` manual que oculta `password`.
  - `pub struct DbConn` con `pub fn connect(p: &ConnectParams) -> Result<DbConn, DbError>`, `pub fn server_version(&self) -> DbVersion`, `pub fn raw(&self) -> &oracle::Connection`, `pub fn ping(&self) -> Result<(), DbError>`.

- [ ] **Step 1: Tests que fallan (unitarios, sin BD)**

```rust
// error.rs
#[test] fn clasifica_codigos() {
    assert_eq!(classify("DPI-1047"), ErrorKind::ClientMissing);
    assert_eq!(classify("ORA-01017"), ErrorKind::InvalidCredentials);
    assert_eq!(classify("ORA-28001"), ErrorKind::PasswordExpired);
    assert_eq!(classify("ORA-12154"), ErrorKind::UnknownService);
    assert_eq!(classify("ORA-12514"), ErrorKind::UnknownService);
    assert_eq!(classify("ORA-12541"), ErrorKind::UnknownService);
    for c in ["ORA-03113","ORA-03114","ORA-03135","ORA-02396","DPI-1080","DPI-1010"] {
        assert_eq!(classify(c), ErrorKind::ConnectionLost, "{c}");
    }
    assert_eq!(classify("ORA-00942"), ErrorKind::Other);
}
// connect.rs
#[test] fn debug_oculta_password() {
    let p = ConnectParams { user:"hr".into(), password:"s3cr3t".into(), db:"dev".into(), role:Role::Normal };
    assert!(!format!("{p:?}").contains("s3cr3t"));
}
// client.rs
#[test] fn ayuda_menciona_variable_de_entorno() {
    let h = client_help();
    if cfg!(windows) { assert!(h.contains("PATH")) } else { assert!(h.contains("LD_LIBRARY_PATH")) }
    assert!(h.contains("19") && h.contains("21") && h.contains("64 bits"));
}
```

- [ ] **Step 2: Verificar que fallan**

Run: `cargo test -p openpl-oracle`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `error.rs`, `client.rs`, `connect.rs`**

- `From<oracle::Error>`: extraer el código desde `oracle::Error::OciError(dberr)` / `DpiError(dberr)` como `ORA-{:05}` o el prefijo `DPI-NNNN` del mensaje; `kind = classify(code)`. Mensaje: para `InvalidCredentials` "Usuario o contraseña incorrectos.", `PasswordExpired` "La contraseña expiró; cámbiela con otra herramienta (cambio de clave llegará en una versión posterior).", `UnknownService` "No se encontró la base de datos '{db}' o su listener: revise el alias TNS o host:puerto/servicio.", `ClientMissing` "No se encontró Oracle Instant Client (64 bits)."; resto: mensaje original de Oracle.
- `client_version()`: `oracle::Version::client()` mapeado a `DbVersion`.
- `DbConn::connect`: `oracle::Connector::new(user, password, db)` con `privilege(Privilege::Sysdba|Sysoper)` según `role`; `server_version` desde `conn.server_version()` en el connect y guardado en el struct.
- `ping`: `conn.ping()`.

- [ ] **Step 4: Test de integración en `tests/live.rs`**

```rust
fn params() -> Option<ConnectParams> { /* lee OPENPL_TEST_*; None → eprintln!("SKIP: OPENPL_TEST_* no definidas") */ }
#[test] fn conecta_y_lee_version() {
    let Some(p) = params() else { return };
    let c = DbConn::connect(&p).unwrap();
    assert!(c.server_version() >= DbVersion::new(12,1,0));
    c.ping().unwrap();
}
#[test] fn clave_erronea_da_invalid_credentials() {
    let Some(mut p) = params() else { return };
    p.password = "clave-que-no-existe-xyz".into();
    let e = DbConn::connect(&p).err().unwrap();
    assert_eq!(e.kind, ErrorKind::InvalidCredentials);
    assert_eq!(e.code.as_deref(), Some("ORA-01017"));
}
#[test] fn servicio_inexistente_da_unknown_service() {
    let Some(mut p) = params() else { return };
    p.db = "127.0.0.1:1/no_existe".into();
    assert_eq!(DbConn::connect(&p).err().unwrap().kind, ErrorKind::UnknownService);
}
```

- [ ] **Step 5: Verificar**

Run: `cargo test -p openpl-oracle`
Expected: todos pasan (los live imprimen SKIP si no hay variables). Con variables definidas contra una BD real: también pasan.

- [ ] **Step 6: Commit**

```bash
git add crates/openpl-oracle
git commit -m "feat(oracle): clasificación de errores, detección de cliente y conexión"
```

---

### Task 3: Perfiles de conexión y contraseñas

**Files:**
- Create: `crates/openpl-core/Cargo.toml`, `crates/openpl-core/src/lib.rs`, `crates/openpl-core/src/profiles.rs`, `crates/openpl-core/src/secrets.rs`
- Modify: `Cargo.toml` (agregar member)

**Interfaces:**
- Consumes: `Role` (Task 2).
- Produces:
  - `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)] pub struct ConnectionProfile { pub id: Uuid, pub name: String, pub user: String, pub db: String, pub role: Role, pub environment: Option<Environment>, pub save_password: bool }` con `#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)] #[serde(rename_all = "lowercase")] pub enum Environment { Dev, Qa, Prod }`
  - `pub struct ProfileStore { path: PathBuf }` con `pub fn new(path: PathBuf) -> Self`, `pub fn default_path() -> PathBuf` (`dirs::config_dir()/openpl/connections.json`), `pub fn load(&self) -> Result<Vec<ConnectionProfile>, CoreError>` (archivo ausente → `vec![]`), `pub fn upsert(&self, p: ConnectionProfile) -> Result<(), CoreError>`, `pub fn delete(&self, id: Uuid) -> Result<(), CoreError>`.
  - `pub trait SecretStore: Send + Sync { fn set(&self, id: Uuid, pw: &str) -> Result<(), CoreError>; fn get(&self, id: Uuid) -> Result<Option<String>, CoreError>; fn delete(&self, id: Uuid) -> Result<(), CoreError>; }`
  - `pub struct KeyringStore;` (servicio `"openpl"`, cuenta = `id.to_string()`) y `pub struct MemoryStore` (para tests).
  - `#[derive(Debug, thiserror::Error, Serialize)] pub enum CoreError { Io(String), Json(String), Secret(String), Db(#[from] DbError), SessionNotFound, Disconnected }`

- [ ] **Step 1: Tests que fallan (`profiles.rs`)**

```rust
#[test] fn load_sin_archivo_devuelve_vacio() { /* tempdir, ProfileStore::new(dir/"c.json").load() == vec![] */ }
#[test] fn upsert_y_load_ida_y_vuelta() { /* upsert perfil, load → igual */ }
#[test] fn upsert_reemplaza_mismo_id() { /* 2 upserts mismo id con nombre distinto → 1 perfil con el 2º nombre */ }
#[test] fn delete_quita_perfil() { /* ... */ }
#[test] fn json_no_contiene_password() {
    // upsert con save_password=true; leer el archivo crudo; assert!(!raw.contains("password\""))
}
#[test] fn json_corrupto_da_error_json() { /* escribir "{" ; load() → Err(CoreError::Json(_)) */ }
```

- [ ] **Step 2: Verificar que fallan**

Run: `cargo test -p openpl-core profiles`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `ProfileStore` y `SecretStore`**

Escritura atómica: escribir `connections.json.tmp` y renombrar. Crear directorio padre si no existe. `KeyringStore` usa `keyring::Entry::new("openpl", &id.to_string())`; `NoEntry` → `Ok(None)`.

- [ ] **Step 4: Verificar**

Run: `cargo test -p openpl-core profiles`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/openpl-core
git commit -m "feat(core): perfiles de conexión y almacén seguro de contraseñas"
```

---

### Task 4: Catálogo de objetos

**Files:**
- Create: `crates/openpl-core/src/catalog.rs`, `crates/openpl-core/tests/live_catalog.rs`

**Interfaces:**
- Consumes: `DbConn`, `DbError` (Task 2).
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum ObjectType { Package, Procedure, Function, Trigger, Type, Table, View, Sequence, Synonym }` con `pub fn oracle_types(self) -> &'static [&'static str]` (`Package` → `["PACKAGE","PACKAGE BODY"]`, `Type` → `["TYPE","TYPE BODY"]`, resto uno solo) y `pub const ALL: [ObjectType; 9]` en el orden del árbol.
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)] pub enum Scope { Mine, All }`
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] pub enum ObjectStatus { Valid, Invalid }`
  - `#[derive(Debug, Clone, PartialEq, Serialize)] pub struct ObjectInfo { pub owner: String, pub name: String, pub object_type: ObjectType, pub status: ObjectStatus, pub last_ddl_time: String }` (`last_ddl_time` en ISO-8601).
  - `pub struct RawRow { pub owner: String, pub name: String, pub oracle_type: String, pub status: String, pub last_ddl_time: String }`
  - `pub fn objects_query(scope: Scope, t: ObjectType, filter: Option<&str>) -> (String, Vec<(String, String)>)` — SQL y binds nombrados.
  - `pub fn merge_status(t: ObjectType, rows: Vec<RawRow>) -> Vec<ObjectInfo>`
  - `pub fn list_objects(conn: &DbConn, scope: Scope, t: ObjectType, filter: Option<&str>) -> Result<Vec<ObjectInfo>, DbError>`

- [ ] **Step 1: Tests que fallan (unitarios)**

```rust
#[test] fn query_mine_usa_user_y_binds() {
    let (sql, binds) = objects_query(Scope::Mine, ObjectType::Procedure, None);
    assert!(sql.contains("FROM all_objects") && sql.contains("owner = USER"));
    assert!(sql.contains("object_type IN (:t0)"));
    assert_eq!(binds, vec![("t0".into(), "PROCEDURE".into())]);
}
#[test] fn query_package_incluye_body() {
    let (_, b) = objects_query(Scope::All, ObjectType::Package, None);
    assert_eq!(b.iter().map(|x| x.1.as_str()).collect::<Vec<_>>(), ["PACKAGE","PACKAGE BODY"]);
}
#[test] fn filtro_escapa_comodines_y_es_contiene() {
    let (sql, b) = objects_query(Scope::Mine, ObjectType::Package, Some("pkg_v%"));
    assert!(sql.contains("UPPER(object_name) LIKE :f ESCAPE '\\'"));
    assert!(b.contains(&("f".into(), "%PKG\\_V\\%%".into())));
}
#[test] fn query_excluye_recyclebin_y_ordena() {
    let (sql, _) = objects_query(Scope::All, ObjectType::Table, None);
    assert!(sql.contains("object_name NOT LIKE 'BIN$%'") && sql.contains("ORDER BY owner, object_name"));
}
#[test] fn merge_package_invalido_si_body_invalido() {
    let rows = vec![raw("HR","PKG_A","PACKAGE","VALID"), raw("HR","PKG_A","PACKAGE BODY","INVALID"),
                    raw("HR","PKG_B","PACKAGE","VALID")];
    let out = merge_status(ObjectType::Package, rows);
    assert_eq!(out.len(), 2);
    assert_eq!(out[0].status, ObjectStatus::Invalid);
    assert_eq!(out[1].status, ObjectStatus::Valid);
}
#[test] fn merge_conserva_nombres_en_minusculas() {
    let out = merge_status(ObjectType::Table, vec![raw("HR","mi_tabla","TABLE","VALID")]);
    assert_eq!(out[0].name, "mi_tabla");
}
#[test] fn merge_last_ddl_time_es_el_mayor() { /* spec 2024-01-01, body 2024-05-01 → "2024-05-01..." */ }
```

- [ ] **Step 2: Verificar que fallan**

Run: `cargo test -p openpl-core catalog`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar**

`objects_query`: `SELECT owner, object_name, object_type, status, TO_CHAR(last_ddl_time,'YYYY-MM-DD"T"HH24:MI:SS') FROM all_objects WHERE object_type IN (:t0[, :t1]) [AND owner = USER] [AND UPPER(object_name) LIKE :f ESCAPE '\'] AND object_name NOT LIKE 'BIN$%' ORDER BY owner, object_name`. Filtro: mayúsculas, escapar `\`, `%`, `_` con `\`, envolver en `%…%`. `merge_status`: agrupar por (owner, name) preservando orden de llegada; `Invalid` si alguna fila no es `VALID`. `list_objects` ejecuta con binds nombrados y mapea a `RawRow`. Compatible con 12.1 (sin `FETCH FIRST`).

- [ ] **Step 4: Test de integración `live_catalog.rs`**

```rust
#[test] fn lista_tablas_propias_sin_error() {
    let Some(c) = conn() else { return };
    let v = list_objects(&c, Scope::Mine, ObjectType::Table, None).unwrap();
    assert!(v.iter().all(|o| o.object_type == ObjectType::Table));
}
#[test] fn todos_los_tipos_consultan_sin_error() {
    let Some(c) = conn() else { return };
    for t in ObjectType::ALL { list_objects(&c, Scope::Mine, t, Some("A")).unwrap(); }
}
```

- [ ] **Step 5: Verificar**

Run: `cargo test -p openpl-core catalog && cargo test -p openpl-core --test live_catalog`
Expected: todos pasan (live con SKIP si no hay variables).

- [ ] **Step 6: Commit**

```bash
git add crates/openpl-core
git commit -m "feat(core): catálogo de objetos con filtro y estado combinado"
```

---

### Task 5: Sesiones en hilo propio

**Files:**
- Create: `crates/openpl-core/src/session.rs`

**Interfaces:**
- Consumes: `DbConn`, `ConnectParams`, `DbError`, `ErrorKind` (Task 2); `CoreError` (Task 3).
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)] pub struct SessionId(pub Uuid)`
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] pub enum SessionState { Connected, Disconnected }`
  - `pub trait Connector: Send + Sync + 'static { type Conn: Send + 'static; fn connect(&self, p: &ConnectParams) -> Result<Self::Conn, DbError>; }` con `pub struct OracleConnector;` (`Conn = DbConn`) — permite tests con un conector falso.
  - `pub struct Session<C: Connector>`: un hilo dueño de la conexión, recibe trabajos por `std::sync::mpsc`.
    - `pub fn open(connector: Arc<C>, p: ConnectParams) -> Result<Self, DbError>` (bloqueante; llamar desde `spawn_blocking`)
    - `pub async fn run<R: Send + 'static>(&self, f: impl FnOnce(&C::Conn) -> Result<R, DbError> + Send + 'static) -> Result<R, CoreError>` — responde por `tokio::sync::oneshot`; si el error es `ErrorKind::ConnectionLost`, el estado pasa a `Disconnected` y devuelve `CoreError::Db(e)`; con estado `Disconnected` devuelve `CoreError::Disconnected` sin ejecutar.
    - `pub fn state(&self) -> SessionState`
    - `pub async fn reconnect(&self) -> Result<(), CoreError>` — reconecta con los mismos parámetros en el mismo hilo.
    - `Drop`: cierra el canal; el hilo termina y suelta la conexión.
  - `pub struct SessionManager<C: Connector>` con `pub fn new(c: Arc<C>) -> Self`, `pub async fn open(&self, p: ConnectParams) -> Result<SessionId, CoreError>`, `pub fn get(&self, id: SessionId) -> Result<Arc<Session<C>>, CoreError>` (`SessionNotFound`), `pub fn close(&self, id: SessionId)`.

- [ ] **Step 1: Tests que fallan (con conector falso)**

```rust
// FakeConnector: Conn = FakeConn { fail_with: Arc<Mutex<Option<&'static str>>> }
#[tokio::test] async fn run_ejecuta_en_el_hilo_de_la_sesion() {
    let id_hilo = /* run(|_| Ok(std::thread::current().id())) */;
    assert_ne!(id_hilo, std::thread::current().id());
}
#[tokio::test] async fn conexion_perdida_marca_desconectada() {
    // run que devuelve DbError{code:Some("ORA-03113"), kind:ConnectionLost,..}
    assert_eq!(session.state(), SessionState::Disconnected);
    assert!(matches!(session.run(|_| Ok(1)).await, Err(CoreError::Disconnected)));
}
#[tokio::test] async fn reconnect_vuelve_a_connected() {
    // tras ConnectionLost, reconnect().await.unwrap(); state()==Connected; run(|_| Ok(1)) == Ok(1)
}
#[tokio::test] async fn error_normal_no_desconecta() {
    // run devuelve ORA-00942 → Err, pero state()==Connected
}
#[tokio::test] async fn manager_get_inexistente() {
    assert!(matches!(mgr.get(SessionId(Uuid::new_v4())), Err(CoreError::SessionNotFound)));
}
#[tokio::test] async fn close_elimina_sesion() { /* open, close, get → SessionNotFound */ }
```

- [ ] **Step 2: Verificar que fallan**

Run: `cargo test -p openpl-core session`
Expected: FAIL de compilación.

- [ ] **Step 3: Implementar `Session` y `SessionManager`**

Estado en `Arc<AtomicU8>`. Trabajos como `Box<dyn FnOnce(&mut Option<C::Conn>) + Send>`; `reconnect` envía un trabajo que reemplaza la conexión. `SessionManager` guarda `RwLock<HashMap<SessionId, Arc<Session<C>>>>`.

- [ ] **Step 4: Verificar**

Run: `cargo test -p openpl-core session`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/openpl-core
git commit -m "feat(core): sesiones en hilo propio con detección de conexión perdida"
```

---

### Task 6: App Tauri y comandos IPC

**Files:**
- Create: `app/package.json`, `app/vite.config.ts`, `app/tsconfig.json`, `app/index.html`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/types.ts`, `app/src/api.ts`
- Create: `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/build.rs`, `app/src-tauri/src/main.rs`, `app/src-tauri/src/state.rs`, `app/src-tauri/src/commands.rs`
- Modify: `Cargo.toml` (member `app/src-tauri`)

**Interfaces:**
- Consumes: todo lo de Tasks 1–5.
- Produces (comandos Tauri, nombres exactos; errores serializados como `CoreError`):
  - `client_info() -> ClientInfo` donde `#[derive(Serialize)] pub struct ClientInfo { pub version: Option<String>, pub error: Option<DbError>, pub help: String, pub lib_dir: Option<String> }` — nunca falla.
  - `set_client_dir(dir: Option<String>) -> Result<(), CoreError>` — guarda `oracle_client_dir` en `dirs::config_dir()/openpl/settings.json` (struct `AppSettings { oracle_client_dir: Option<String> }`, en `state.rs`); aplica al reiniciar la app. `main.rs` lee `AppSettings` y llama `init_client` antes de construir el estado.
  - `list_profiles() -> Result<Vec<ConnectionProfile>, CoreError>`
  - `save_profile(profile: ConnectionProfile, password: Option<String>) -> Result<(), CoreError>` — si `save_password` y hay password → `SecretStore::set`; si `!save_password` → `SecretStore::delete`.
  - `delete_profile(id: Uuid) -> Result<(), CoreError>` — borra perfil y secreto.
  - `stored_password(id: Uuid) -> Result<Option<String>, CoreError>`
  - `connect(params: ConnectParams) -> Result<ConnectResult, CoreError>` con `#[derive(Serialize)] pub struct ConnectResult { pub session_id: SessionId, pub server_version: String, pub compat: Compat }`. Si `compat` es `Unsupported`, cierra la sesión y devuelve `CoreError::Db(DbError{ code: None, kind: Other, message: reason })`.
  - `disconnect(session_id: SessionId)`
  - `reconnect(session_id: SessionId) -> Result<(), CoreError>`
  - `session_state(session_id: SessionId) -> Result<SessionState, CoreError>`
  - `list_objects(session_id: SessionId, scope: Scope, object_type: ObjectType, filter: Option<String>) -> Result<Vec<ObjectInfo>, CoreError>`
  - Frontend: `app/src/types.ts` con tipos TS equivalentes (serde por defecto: enums como strings `"Package"`, `Compat` como `{kind, reason?}`), y `app/src/api.ts` exportando `api.clientInfo()`, `api.listProfiles()`, `api.saveProfile(p, pw)`, `api.deleteProfile(id)`, `api.storedPassword(id)`, `api.connect(params)`, `api.disconnect(id)`, `api.reconnect(id)`, `api.sessionState(id)`, `api.listObjects(id, scope, type, filter)`, `api.setClientDir(dir)`.

- [ ] **Step 1: Generar esqueleto**

Run (en raíz): `npm create tauri-app@latest app -- --template react-ts --manager npm --yes` y ajustar: nombre del crate `openpl-app`, `productName` "OpenPL", `identifier` `org.openpl.app`, ventana 1280×800, licencia. Agregar dependencias de workspace `openpl-oracle`, `openpl-core`, `tokio`.
Run: `cd app && npm install && npm run tauri build -- --debug --no-bundle`
Expected: compila sin errores.

- [ ] **Step 2: Test que falla de la capa de comandos**

En `commands.rs` separar la lógica en funciones `async fn *_impl(state: &AppState, …)` testeables con `MemoryStore` y el `FakeConnector` (exponer `FakeConnector` en `openpl-core` bajo `#[cfg(any(test, feature = "testing"))]`).

```rust
#[tokio::test] async fn save_profile_sin_guardar_password_borra_secreto() {
    // set previo en MemoryStore; save_profile_impl(p{save_password:false}, Some("x")) → stored_password_impl == None
}
#[tokio::test] async fn connect_incompatible_cierra_sesion() {
    // FakeConnector reportando server 11.2 → Err; manager vacío
}
#[tokio::test] async fn client_info_sin_cliente_no_falla() {
    // client_info_impl con lector de versión falso que devuelve DPI-1047 → version None, error.kind ClientMissing, help no vacío
}
```

- [ ] **Step 3: Verificar que fallan**

Run: `cargo test -p openpl-app`
Expected: FAIL de compilación.

- [ ] **Step 4: Implementar `state.rs` y `commands.rs`**

`pub struct AppState<C: Connector = OracleConnector> { profiles: ProfileStore, secrets: Arc<dyn SecretStore>, sessions: SessionManager<C>, client_version: Box<dyn Fn() -> Result<DbVersion, DbError> + Send + Sync> }`; los `*_impl` son genéricos en `C`, los `#[tauri::command]` usan `AppState` (por defecto `OracleConnector`). `connect` corre `DbConn::connect` en `spawn_blocking`. Registrar todos los comandos en `main.rs`.

- [ ] **Step 5: Verificar**

Run: `cargo test -p openpl-app && cd app && npx tsc --noEmit`
Expected: tests pasan; TypeScript sin errores.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml app
git commit -m "feat(app): esqueleto Tauri y comandos IPC de conexión y catálogo"
```

---

### Task 7: Arranque, login y barra de conexión

**Files:**
- Create: `docs/behavior/conexion.md`
- Create: `app/src/components/StartupCheck.tsx`, `app/src/components/LoginDialog.tsx`, `app/src/components/ConnectionBar.tsx`
- Test: `app/src/components/StartupCheck.test.tsx`, `app/src/components/LoginDialog.test.tsx`, `app/src/components/ConnectionBar.test.tsx`
- Modify: `app/src/App.tsx`, `app/package.json` (vitest, @testing-library/react, jsdom)

**Interfaces:**
- Consumes: `api.*` y tipos de Task 6.
- Produces:
  - `<StartupCheck onReady={(info: ClientInfo) => void} />`
  - `<LoginDialog onConnected={(c: ActiveConnection) => void} />` donde `type ActiveConnection = { sessionId: string; label: string; environment: "dev" | "qa" | "prod" | null; serverVersion: string; compat: Compat }` (definido en `types.ts`; `label` = `"USER en db"`, p. ej. "HR en DEV").
  - `<ConnectionBar connections={ActiveConnection[]} activeId={string} onSelect={(id) => void} onDisconnect={(id) => void} onReconnect={(id) => void} states={Record<string, SessionState>} />`

- [ ] **Step 1: Nota de comportamiento**

Escribir `docs/behavior/conexion.md` (palabras propias) a partir de la sección 7.1 del diseño: campos del diálogo, lista de perfiles, guardar contraseña, colores por conexión, mensajes de error, compatibilidad. El usuario la revisa antes de seguir.

- [ ] **Step 2: Tests que fallan** (mock de `api` con `vi.mock('../api')`)

```tsx
test('sin Instant Client muestra error y ayuda, y botón Reintentar', async () => {
  // clientInfo → {version:null, error:{kind:'ClientMissing',code:'DPI-1047',message:'No se encontró...'}, help:'Agregue ... PATH'}
  // expect texto 'DPI-1047', expect texto de help, click 'Reintentar' → clientInfo llamado 2 veces
});
test('elegir carpeta del cliente llama setClientDir y pide reiniciar', ...); // campo de ruta + 'Guardar' → api.setClientDir('C:\\oracle\\ic19'); texto 'Reinicie OpenPL'
test('con cliente llama onReady', ...);
test('login exitoso llama onConnected con label "HR en DEV" y environment del perfil', ...);
test('clave errónea muestra ORA-01017 y conserva los campos', async () => {
  // connect rechaza {Db:{code:'ORA-01017',kind:'InvalidCredentials',message:'Usuario o contraseña incorrectos.'}}
  // expect texto 'ORA-01017', input usuario mantiene valor, password vacío
});
test('elegir perfil guardado completa campos y contraseña guardada', ...);
test('compat Warn muestra aviso pero conecta', ...);
test('guardar perfil con "Guardar contraseña" desmarcado no envía password', ...);
test('ConnectionBar muestra la franja del entorno y estado desconectado con botón Reconectar', ...);
```

- [ ] **Step 3: Verificar que fallan**

Run: `cd app && npx vitest run`
Expected: FAIL (componentes no existen).

- [ ] **Step 4: Implementar componentes**

`LoginDialog` (como el tablero "4 · Conexión" del mockup): perfiles agrupados por entorno a la izquierda con buscador; campos Usuario, Contraseña, Base de datos (placeholder "alias TNS o host:puerto/servicio"), Rol (Normal/SYSDBA/SYSOPER), Entorno (Desarrollo/Calidad/Producción, que define el color), Nombre del perfil, "Guardar contraseña"; botones Guardar perfil, Eliminar perfil, Cancelar, Conectar. El error se muestra bajo la contraseña con código ORA y texto corto. `ConnectionProfile.color` pasa a ser `environment: "dev" | "qa" | "prod" | null`. Enter = Conectar. `App.tsx`: StartupCheck → LoginDialog → layout principal con ConnectionBar arriba y el explorador a la izquierda (Task 8); "Nueva conexión" reabre LoginDialog. Sondeo de `sessionState` no: el estado se actualiza cuando un comando devuelve `ConnectionLost`/`Disconnected`.

- [ ] **Step 5: Verificar**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: todos pasan.

- [ ] **Step 6: Verificación manual**

Run: `cd app && npm run tauri dev`. Con una BD real: conectar, guardar perfil con contraseña, cerrar y reabrir la app, conectar desde el perfil sin escribir la contraseña. Renombrar temporalmente la carpeta del cliente Oracle → la app muestra el error DPI-1047 y la ayuda.
Expected: todo según la nota de comportamiento.

- [ ] **Step 7: Commit**

```bash
git add docs/behavior/conexion.md app
git commit -m "feat(app): verificación de cliente, diálogo de login y barra de conexiones"
```

---

### Task 8: Explorador de objetos

**Files:**
- Create: `docs/behavior/explorador.md`
- Create: `app/src/components/ObjectBrowser.tsx`, `app/src/components/ObjectBrowser.test.tsx`
- Modify: `app/src/App.tsx`

**Interfaces:**
- Consumes: `api.listObjects`, `ObjectType`, `ObjectInfo`, `Scope`, `ActiveConnection`.
- Produces: `<ObjectBrowser connection={ActiveConnection} onOpenObject={(o: ObjectInfo) => void} onConnectionLost={() => void} />` — `onOpenObject` se dispara con doble clic o Enter; en este plan `App.tsx` solo muestra un aviso "Edición disponible en una versión posterior" (los planes 2–3 lo conectan).

- [ ] **Step 1: Nota de comportamiento**

`docs/behavior/explorador.md` desde la sección 7.3 del diseño. El usuario la revisa.

- [ ] **Step 2: Tests que fallan**

```tsx
test('muestra los 9 tipos en orden y no consulta hasta expandir', async () => {
  // labels: Paquetes, Procedimientos, Funciones, Triggers, Tipos, Tablas, Vistas, Secuencias, Sinónimos
  // listObjects no llamado
});
test('expandir Paquetes consulta solo ese tipo con Scope Mine', ...); // listObjects(id,'Mine','Package',null)
test('objeto inválido se marca', ...); // elemento con aria-label que contiene 'inválido'
test('filtro consulta de nuevo con el texto tras 300 ms', ...); // fake timers; listObjects(...,'pkg_v')
test('cambiar a Todos muestra owner.nombre', ...); // 'HR.PKG_A'
test('doble clic llama onOpenObject', ...);
test('error ConnectionLost llama onConnectionLost', ...);
test('Refrescar vuelve a consultar los tipos expandidos', ...);
```

- [ ] **Step 3: Verificar que fallan**

Run: `cd app && npx vitest run ObjectBrowser`
Expected: FAIL.

- [ ] **Step 4: Implementar `ObjectBrowser`**

Como el panel izquierdo del tablero "1 · Ventana de programa": cabecera con íconos Objetos/Buscar/Historial y selector Míos/Todos, caja de filtro con ícono de embudo, ícono Phosphor con tinte por tipo (paquete accent, procedimiento/función `--fn`, trigger `--env-qa`, tabla/vista `--st`, tipo `--ty`), contador a la derecha y "inválido" en `--err`. Árbol con nodos por tipo; carga al expandir; caché por (scope, tipo, filtro) invalidada con Refrescar; caja de filtro con debounce de 300 ms; selector Mis objetos / Todos; icono y `aria-label` "inválido" para `Invalid`; navegación con teclado (flechas, Enter). Listas largas renderizadas con virtualización (`@tanstack/react-virtual`) para miles de objetos.

- [ ] **Step 5: Verificar**

Run: `cd app && npx vitest run && npx tsc --noEmit`
Expected: todos pasan.

- [ ] **Step 6: Verificación manual**

`npm run tauri dev` contra un esquema real con muchos objetos: expandir Tablas y Paquetes, filtrar por `_`, alternar Mis objetos/Todos, compilar un objeto inválido desde otra herramienta y Refrescar.
Expected: respuesta fluida, sin congelar la ventana; el estado se actualiza.

- [ ] **Step 7: Commit**

```bash
git add docs/behavior/explorador.md app
git commit -m "feat(app): explorador de objetos con carga por tipo y filtro"
```

---

### Task 9: Integración continua

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: comandos de test de todas las tareas.

- [ ] **Step 1: Escribir workflow**

Jobs:
- `linux`: `ubuntu-24.04`; servicio `gvenzl/oracle-xe:18-slim` (puerto 1521, `ORACLE_PASSWORD`, `APP_USER=openpl`, `APP_USER_PASSWORD`); instalar Instant Client 19 Basic Light x64 desde download.oracle.com y `libaio1t64` (con symlink `libaio.so.1`); deps de Tauri; `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`, `cargo test --workspace` con `OPENPL_TEST_USER=openpl`, `OPENPL_TEST_DB=localhost:1521/XEPDB1`; `cd app && npm ci && npx vitest run && npx tsc --noEmit`.
- `windows`: `windows-latest`; Instant Client 19 x64 en `PATH`; `cargo test --workspace` (los live hacen SKIP); vitest.

Nota: la imagen gratuita más cercana a 12c en contenedor es XE 18c (no hay 19c ni 12c gratuitas); la compatibilidad con 12.1 se valida con la lista manual (spec §8).

- [ ] **Step 2: Verificar**

Push a una rama y abrir PR.
Expected: ambos jobs en verde; en `linux` los tests live se ejecutan (no SKIP) — verificar en el log que no aparece `SKIP:`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pruebas en Linux con Oracle XE 18c y en Windows"
```
