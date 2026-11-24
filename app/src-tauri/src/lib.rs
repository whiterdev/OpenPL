//! Aplicación Tauri de OpenPL.

pub mod commands;
pub mod state;

use openpl_core::session::{OracleConnector, SessionManager};
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
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::client_info,
            commands::set_client_dir,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::stored_password,
            commands::connect,
            commands::disconnect,
            commands::reconnect,
            commands::session_state,
            commands::list_objects,
            commands::object_ddl,
            commands::editor_object,
            commands::describe_columns,
            commands::complete_objects,
            commands::object_columns,
            commands::program_source,
            commands::open_program_file,
            commands::save_program_file,
            commands::recompile,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar OpenPL");
}
