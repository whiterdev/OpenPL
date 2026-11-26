//! Aplicación Tauri de OpenPL.

pub mod commands;
pub mod state;

use openpl_core::session::{OracleConnector, SessionManager};
use openpl_core::workspace::WorkspaceStore;
use openpl_core::{KeyringStore, ProfileStore};
use state::{AppSettings, AppState};
use std::path::Path;
use std::sync::Arc;

pub fn run() {
    let settings_path = AppSettings::default_path();
    let settings = AppSettings::load(&settings_path);
    // Si falla (cliente ausente), la app arranca igual y la pantalla inicial lo explica.
    let init_error =
        openpl_oracle::init_client(settings.oracle_client_dir.as_deref().map(Path::new)).err();

    let state = AppState {
        profiles: ProfileStore::new(ProfileStore::default_path()),
        workspaces: WorkspaceStore::new(WorkspaceStore::default_dir()),
        secrets: Arc::new(KeyringStore),
        sessions: SessionManager::new(Arc::new(OracleConnector)),
        client_version: Box::new(move || match &init_error {
            Some(e) => Err(e.clone()),
            None => openpl_oracle::client_version(),
        }),
        settings_path,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::client_info,
            commands::set_client_dir,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::stored_password,
            commands::load_workspace,
            commands::save_workspace,
            commands::clear_workspace,
            commands::connect,
            commands::disconnect,
            commands::reconnect,
            commands::session_state,
            commands::session_siblings,
            commands::session_ping,
            commands::list_objects,
            commands::routine_overloads,
            commands::object_ddl,
            commands::editor_object,
            commands::describe_columns,
            commands::complete_objects,
            commands::object_columns,
            commands::sql_open,
            commands::sql_close,
            commands::sql_execute,
            commands::sql_explain,
            commands::sql_fetch,
            commands::sql_cancel,
            commands::sql_commit,
            commands::sql_rollback,
            commands::sql_edit_target,
            commands::sql_apply,
            commands::program_source,
            commands::open_program_file,
            commands::save_program_file,
            commands::read_script_file,
            commands::write_spool_file,
            commands::recompile,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar OpenPL");
}

#[cfg(test)]
mod tests {
    #[test]
    fn la_ventana_principal_abre_maximizada() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &conf["app"]["windows"][0];
        assert_eq!(window["maximized"], true);
        assert_eq!(window["center"], true);
    }

    fn es_semver(version: &str) -> bool {
        let (nucleo, pre) = match version.split_once('-') {
            Some((nucleo, pre)) => (nucleo, Some(pre)),
            None => (version, None),
        };
        let partes: Vec<&str> = nucleo.split('.').collect();
        let nucleo_ok = partes.len() == 3
            && partes.iter().all(|p| {
                !p.is_empty()
                    && p.chars().all(|c| c.is_ascii_digit())
                    && (*p == "0" || !p.starts_with('0'))
            });
        let pre_ok = pre.is_none_or(|pre| {
            pre.split('.').all(|id| {
                !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            })
        });
        nucleo_ok && pre_ok
    }

    #[test]
    fn la_version_es_la_misma_en_todos_lados() {
        let cargo = env!("CARGO_PKG_VERSION");
        let tauri: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let npm: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert!(es_semver(cargo), "la versión {cargo} no es semver");
        assert_eq!(tauri["version"], cargo, "tauri.conf.json");
        assert_eq!(npm["version"], cargo, "package.json");
    }

    #[test]
    fn es_semver_acepta_pre_release_y_rechaza_formas_rotas() {
        assert!(es_semver("1.0.0"));
        assert!(es_semver("1.0.0-beta.5"));
        assert!(!es_semver("1.0"));
        assert!(!es_semver("1.0.0-"));
        assert!(!es_semver("01.0.0"));
        assert!(!es_semver("1.0.0-beta..5"));
    }
}
