//! Comandos IPC. La lógica vive en funciones `*_impl` testeables sin Tauri.

use crate::state::{AppSettings, AppState};
use openpl_core::catalog::{ObjectInfo, ObjectType, Scope};
use openpl_core::session::{Connector, SessionId, SessionState};
use openpl_core::{ConnectionProfile, CoreError};
use openpl_oracle::{Compat, ConnectParams, DbError};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct ClientInfo {
    pub version: Option<String>,
    pub error: Option<DbError>,
    pub help: String,
    pub lib_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConnectResult {
    pub session_id: SessionId,
    pub server_version: String,
    pub compat: Compat,
}

pub fn client_info_impl<C: Connector>(st: &AppState<C>) -> ClientInfo {
    let lib_dir = AppSettings::load(&st.settings_path).oracle_client_dir;
    let help = openpl_oracle::client_help().to_string();
    match (st.client_version)() {
        Ok(v) => ClientInfo {
            version: Some(v.to_string()),
            error: None,
            help,
            lib_dir,
        },
        Err(e) => ClientInfo {
            version: None,
            error: Some(e),
            help,
            lib_dir,
        },
    }
}

pub fn set_client_dir_impl<C: Connector>(
    st: &AppState<C>,
    dir: Option<String>,
) -> Result<(), CoreError> {
    let mut s = AppSettings::load(&st.settings_path);
    s.oracle_client_dir = dir.filter(|d| !d.trim().is_empty());
    s.save(&st.settings_path)
}

pub fn list_profiles_impl<C: Connector>(
    st: &AppState<C>,
) -> Result<Vec<ConnectionProfile>, CoreError> {
    st.profiles.load()
}

pub fn save_profile_impl<C: Connector>(
    st: &AppState<C>,
    profile: ConnectionProfile,
    password: Option<String>,
) -> Result<(), CoreError> {
    if profile.save_password {
        if let Some(pw) = password.filter(|p| !p.is_empty()) {
            st.secrets.set(profile.id, &pw)?;
        }
    } else {
        st.secrets.delete(profile.id)?;
    }
    st.profiles.upsert(profile)
}

pub fn delete_profile_impl<C: Connector>(st: &AppState<C>, id: Uuid) -> Result<(), CoreError> {
    st.secrets.delete(id)?;
    st.profiles.delete(id)
}

pub fn stored_password_impl<C: Connector>(
    st: &AppState<C>,
    id: Uuid,
) -> Result<Option<String>, CoreError> {
    st.secrets.get(id)
}

pub async fn connect_impl<C: Connector>(
    st: &AppState<C>,
    params: ConnectParams,
) -> Result<ConnectResult, CoreError> {
    let client = (st.client_version)()?;
    let id = st.sessions.open(params).await?;
    let session = st.sessions.get(id)?;
    let server = session.run(|c| Ok(C::server_version(c))).await?;
    let compat = openpl_oracle::check_compat(client, server);
    if let Compat::Unsupported(reason) = &compat {
        st.sessions.close(id);
        return Err(CoreError::Db(DbError {
            code: None,
            kind: openpl_oracle::ErrorKind::Other,
            message: reason.clone(),
            offset: None,
        }));
    }
    Ok(ConnectResult {
        session_id: id,
        server_version: server.to_string(),
        compat,
    })
}

pub fn disconnect_impl<C: Connector>(st: &AppState<C>, id: SessionId) {
    st.sessions.close(id);
}

pub async fn reconnect_impl<C: Connector>(
    st: &AppState<C>,
    id: SessionId,
) -> Result<(), CoreError> {
    st.sessions.get(id)?.reconnect().await
}

pub fn session_state_impl<C: Connector>(
    st: &AppState<C>,
    id: SessionId,
) -> Result<SessionState, CoreError> {
    Ok(st.sessions.get(id)?.state())
}

pub async fn list_objects_impl(
    st: &AppState,
    id: SessionId,
    scope: Scope,
    object_type: ObjectType,
    filter: Option<String>,
) -> Result<Vec<ObjectInfo>, CoreError> {
    st.sessions
        .get(id)?
        .run(move |c| openpl_core::catalog::list_objects(c, scope, object_type, filter.as_deref()))
        .await
}

// Comandos Tauri.

type St<'a> = tauri::State<'a, AppState>;

#[tauri::command]
pub fn client_info(st: St<'_>) -> ClientInfo {
    client_info_impl(&st)
}

#[tauri::command]
pub fn set_client_dir(st: St<'_>, dir: Option<String>) -> Result<(), CoreError> {
    set_client_dir_impl(&st, dir)
}

#[tauri::command]
pub fn list_profiles(st: St<'_>) -> Result<Vec<ConnectionProfile>, CoreError> {
    list_profiles_impl(&st)
}

#[tauri::command]
pub fn save_profile(
    st: St<'_>,
    profile: ConnectionProfile,
    password: Option<String>,
) -> Result<(), CoreError> {
    save_profile_impl(&st, profile, password)
}

#[tauri::command]
pub fn delete_profile(st: St<'_>, id: Uuid) -> Result<(), CoreError> {
    delete_profile_impl(&st, id)
}

#[tauri::command]
pub fn stored_password(st: St<'_>, id: Uuid) -> Result<Option<String>, CoreError> {
    stored_password_impl(&st, id)
}

#[tauri::command]
pub async fn connect(st: St<'_>, params: ConnectParams) -> Result<ConnectResult, CoreError> {
    connect_impl(&st, params).await
}

#[tauri::command]
pub fn disconnect(st: St<'_>, session_id: SessionId) {
    disconnect_impl(&st, session_id)
}

#[tauri::command]
pub async fn reconnect(st: St<'_>, session_id: SessionId) -> Result<(), CoreError> {
    reconnect_impl(&st, session_id).await
}

#[tauri::command]
pub fn session_state(st: St<'_>, session_id: SessionId) -> Result<SessionState, CoreError> {
    session_state_impl(&st, session_id)
}

#[tauri::command]
pub async fn list_objects(
    st: St<'_>,
    session_id: SessionId,
    scope: Scope,
    object_type: ObjectType,
    filter: Option<String>,
) -> Result<Vec<ObjectInfo>, CoreError> {
    list_objects_impl(&st, session_id, scope, object_type, filter).await
}

#[tauri::command]
pub async fn object_ddl(
    st: St<'_>,
    session_id: SessionId,
    object_type: ObjectType,
    owner: String,
    name: String,
) -> Result<String, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::actions::get_ddl(c, object_type, &owner, &name))
        .await
}

#[tauri::command]
pub async fn editor_object(
    st: St<'_>,
    session_id: SessionId,
    owner: Option<String>,
    name: String,
    context_owner: Option<String>,
) -> Result<Option<ObjectInfo>, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| {
            openpl_core::catalog::editor_object(
                c,
                owner.as_deref(),
                &name,
                context_owner.as_deref(),
            )
        })
        .await
}

#[tauri::command]
pub async fn describe_columns(
    st: St<'_>,
    session_id: SessionId,
    owner: String,
    name: String,
) -> Result<Vec<openpl_core::catalog::ObjectColumn>, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::catalog::describe_columns(c, &owner, &name))
        .await
}

#[tauri::command]
pub async fn complete_objects(
    st: St<'_>,
    session_id: SessionId,
    owner: Option<String>,
    prefix: String,
    context_owner: Option<String>,
    scope: Option<openpl_core::catalog::CompletionScope>,
) -> Result<Vec<openpl_core::catalog::CompletionObject>, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| {
            openpl_core::catalog::complete_objects(
                c,
                owner.as_deref(),
                &prefix,
                context_owner.as_deref(),
                scope.unwrap_or_default(),
            )
        })
        .await
}

#[tauri::command]
pub async fn object_columns(
    st: St<'_>,
    session_id: SessionId,
    owner: Option<String>,
    name: String,
    context_owner: Option<String>,
) -> Result<Vec<openpl_core::catalog::ObjectColumn>, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| {
            openpl_core::catalog::object_columns(
                c,
                owner.as_deref(),
                &name,
                context_owner.as_deref(),
            )
        })
        .await
}

/// Sesión propia de una Ventana SQL, hermana de `session_id`, con DBMS_OUTPUT activo.
pub async fn sql_open_impl<C: Connector>(
    st: &AppState<C>,
    session_id: SessionId,
) -> Result<SessionId, CoreError> {
    st.sessions.open_sibling(session_id).await
}

#[tauri::command]
pub async fn sql_open(st: St<'_>, session_id: SessionId) -> Result<SessionId, CoreError> {
    let id = sql_open_impl(&st, session_id).await?;
    let session = st.sessions.get(id)?;
    if let Err(e) = session.run(openpl_core::sql::enable_output).await {
        st.sessions.close(id);
        return Err(e);
    }
    Ok(id)
}

#[tauri::command]
pub fn sql_close(st: St<'_>, session_id: SessionId) {
    st.sessions.close(session_id);
}

#[tauri::command]
pub async fn sql_execute(
    st: St<'_>,
    session_id: SessionId,
    sql: String,
    binds: Vec<openpl_core::sql::BindValue>,
    page_size: Option<usize>,
) -> Result<openpl_core::sql::ExecOutcome, CoreError> {
    let size = page_size.unwrap_or(openpl_core::sql::PAGE_SIZE);
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::sql::execute(c, &sql, &binds, size))
        .await
}

#[tauri::command]
pub async fn sql_fetch(
    st: St<'_>,
    session_id: SessionId,
    cursor: u64,
    size: Option<usize>,
) -> Result<openpl_core::sql::QueryPage, CoreError> {
    let size = size.unwrap_or(openpl_core::sql::PAGE_SIZE);
    st.sessions
        .get(session_id)?
        .run(move |_| openpl_core::sql::fetch(cursor, size))
        .await
}

#[tauri::command]
pub fn sql_cancel(st: St<'_>, session_id: SessionId) -> Result<bool, CoreError> {
    Ok(st.sessions.get(session_id)?.interrupt())
}

#[tauri::command]
pub async fn sql_commit(st: St<'_>, session_id: SessionId) -> Result<bool, CoreError> {
    st.sessions
        .get(session_id)?
        .run(openpl_core::sql::commit)
        .await
}

#[tauri::command]
pub async fn sql_rollback(st: St<'_>, session_id: SessionId) -> Result<bool, CoreError> {
    st.sessions
        .get(session_id)?
        .run(openpl_core::sql::rollback)
        .await
}

#[tauri::command]
pub async fn sql_edit_target(
    st: St<'_>,
    session_id: SessionId,
    owner: Option<String>,
    name: String,
) -> Result<Option<openpl_core::grid::EditTarget>, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::grid::edit_target(c, owner.as_deref(), &name))
        .await
}

#[tauri::command]
pub async fn sql_apply(
    st: St<'_>,
    session_id: SessionId,
    target: openpl_core::grid::EditTarget,
    changes: Vec<openpl_core::grid::RowChange>,
) -> Result<openpl_core::grid::ApplyResult, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::grid::apply(c, &target, &changes))
        .await
}

#[tauri::command]
pub async fn program_source(
    st: St<'_>,
    session_id: SessionId,
    object_type: ObjectType,
    owner: String,
    name: String,
) -> Result<Vec<openpl_core::program::ProgramPart>, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::program::load_program(c, object_type, &owner, &name))
        .await
}

#[derive(serde::Serialize)]
pub struct ProgramFile {
    name: String,
    source: String,
}

#[tauri::command]
pub async fn open_program_file(app: tauri::AppHandle) -> Result<Option<ProgramFile>, CoreError> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app
        .dialog()
        .file()
        .add_filter("PL/SQL", &["pks", "pkb", "sql"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| CoreError::Io(e.to_string()))?;
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let source = std::fs::read_to_string(path)?;
    Ok(Some(ProgramFile { name, source }))
}

#[tauri::command]
pub async fn save_program_file(
    app: tauri::AppHandle,
    source: String,
    extension: String,
    name: Option<String>,
) -> Result<Option<String>, CoreError> {
    use tauri_plugin_dialog::DialogExt;
    if !matches!(extension.as_str(), "pks" | "pkb" | "sql") {
        return Err(CoreError::Io("Extensión de programa inválida.".into()));
    }
    let dialog = app.dialog().file().add_filter("PL/SQL", &[&extension]);
    let dialog = match name {
        Some(name) => dialog.set_file_name(name),
        None => dialog.set_file_name(format!("programa.{extension}")),
    };
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| CoreError::Io(e.to_string()))?;
    replace_program_file(&path, &source)?;
    Ok(Some(
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
    ))
}

fn replace_program_file(path: &std::path::Path, source: &str) -> std::io::Result<()> {
    use std::io::Write;

    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(source.as_bytes())?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub async fn recompile(
    st: St<'_>,
    session_id: SessionId,
    object_type: ObjectType,
    owner: String,
    name: String,
) -> Result<openpl_core::actions::RecompileResult, CoreError> {
    st.sessions
        .get(session_id)?
        .run(move |c| openpl_core::actions::recompile(c, object_type, &owner, &name))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpl_core::session::fake::FakeConnector;
    use openpl_core::session::SessionManager;
    use openpl_core::{Environment, MemoryStore, ProfileStore};
    use openpl_oracle::{DbVersion, ErrorKind, Role};
    use std::sync::Arc;

    #[test]
    fn guardar_programa_reemplaza_archivo_completo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("programa.sql");
        std::fs::write(&path, "archivo anterior, más largo").unwrap();
        replace_program_file(&path, "SELECT 1").unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "SELECT 1");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    fn state(
        server: DbVersion,
        client: Result<DbVersion, DbError>,
    ) -> (tempfile::TempDir, AppState<FakeConnector>) {
        let dir = tempfile::tempdir().unwrap();
        let st = AppState {
            profiles: ProfileStore::new(dir.path().join("connections.json")),
            secrets: Arc::new(MemoryStore::default()),
            sessions: SessionManager::new(Arc::new(FakeConnector::new(server))),
            client_version: Box::new(move || client.clone()),
            settings_path: dir.path().join("settings.json"),
        };
        (dir, st)
    }

    fn profile(save_password: bool) -> ConnectionProfile {
        ConnectionProfile {
            id: Uuid::new_v4(),
            name: "HR en DEV".into(),
            user: "HR".into(),
            db: "DEVPDB".into(),
            role: Role::Normal,
            environment: Some(Environment::Dev),
            save_password,
        }
    }

    fn params() -> ConnectParams {
        ConnectParams {
            user: "HR".into(),
            password: "x".into(),
            db: "DEVPDB".into(),
            role: Role::Normal,
        }
    }

    #[test]
    fn save_profile_sin_guardar_password_borra_secreto() {
        let (_d, st) = state(DbVersion::new(19, 0, 0), Ok(DbVersion::new(19, 21, 0)));
        let p = profile(false);
        st.secrets.set(p.id, "vieja").unwrap();
        save_profile_impl(&st, p.clone(), Some("x".into())).unwrap();
        assert_eq!(stored_password_impl(&st, p.id).unwrap(), None);
    }

    #[test]
    fn save_profile_con_password_lo_guarda() {
        let (_d, st) = state(DbVersion::new(19, 0, 0), Ok(DbVersion::new(19, 21, 0)));
        let p = profile(true);
        save_profile_impl(&st, p.clone(), Some("clave".into())).unwrap();
        assert_eq!(
            stored_password_impl(&st, p.id).unwrap(),
            Some("clave".into())
        );
        assert_eq!(list_profiles_impl(&st).unwrap(), vec![p]);
    }

    #[test]
    fn delete_profile_borra_secreto() {
        let (_d, st) = state(DbVersion::new(19, 0, 0), Ok(DbVersion::new(19, 21, 0)));
        let p = profile(true);
        save_profile_impl(&st, p.clone(), Some("clave".into())).unwrap();
        delete_profile_impl(&st, p.id).unwrap();
        assert_eq!(stored_password_impl(&st, p.id).unwrap(), None);
        assert!(list_profiles_impl(&st).unwrap().is_empty());
    }

    #[tokio::test]
    async fn connect_compatible_devuelve_sesion() {
        let (_d, st) = state(DbVersion::new(12, 1, 0), Ok(DbVersion::new(19, 21, 0)));
        let r = connect_impl(&st, params()).await.unwrap();
        assert_eq!(r.server_version, "12.1.0");
        assert_eq!(r.compat, Compat::Supported);
        assert_eq!(
            session_state_impl(&st, r.session_id).unwrap(),
            SessionState::Connected
        );
    }

    #[tokio::test]
    async fn connect_incompatible_cierra_sesion() {
        let (_d, st) = state(DbVersion::new(11, 2, 0), Ok(DbVersion::new(19, 21, 0)));
        let e = connect_impl(&st, params()).await.unwrap_err();
        assert!(matches!(e, CoreError::Db(_)));
        assert!(st.sessions.is_empty());
    }

    #[tokio::test]
    async fn ventana_sql_abre_una_sesion_hermana() {
        let (_d, st) = state(DbVersion::new(19, 0, 0), Ok(DbVersion::new(19, 21, 0)));
        let main = connect_impl(&st, params()).await.unwrap().session_id;
        let sql = sql_open_impl(&st, main).await.unwrap();
        assert_ne!(main, sql);
        st.sessions.close(sql);
        assert!(st.sessions.get(main).is_ok());
    }

    #[test]
    fn client_info_sin_cliente_no_falla() {
        let missing = DbError::from_code(
            Some("DPI-1047".into()),
            "DPI-1047: Cannot locate a 64-bit Oracle Client library",
        );
        let (_d, st) = state(DbVersion::new(19, 0, 0), Err(missing));
        let info = client_info_impl(&st);
        assert_eq!(info.version, None);
        assert_eq!(info.error.unwrap().kind, ErrorKind::ClientMissing);
        assert!(!info.help.is_empty());
    }

    #[test]
    fn set_client_dir_guarda_preferencia() {
        let (_d, st) = state(DbVersion::new(19, 0, 0), Ok(DbVersion::new(19, 21, 0)));
        set_client_dir_impl(&st, Some("C:\\oracle\\ic19".into())).unwrap();
        assert_eq!(
            client_info_impl(&st).lib_dir.as_deref(),
            Some("C:\\oracle\\ic19")
        );
    }
}
