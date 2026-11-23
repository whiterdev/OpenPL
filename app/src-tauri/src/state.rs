//! Estado compartido de la app y preferencias persistentes.

use openpl_core::session::{Connector, OracleConnector, SessionManager};
use openpl_core::{CoreError, ProfileStore, SecretStore};
use openpl_oracle::{DbError, DbVersion};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub oracle_client_dir: Option<String>,
}

impl AppSettings {
    /// `<config del usuario>/openpl/settings.json`
    pub fn default_path() -> PathBuf {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("openpl").join("settings.json")
    }

    /// Archivo ausente o inválido: valores por defecto.
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), CoreError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }
}

pub type VersionFn = Box<dyn Fn() -> Result<DbVersion, DbError> + Send + Sync>;

pub struct AppState<C: Connector = OracleConnector> {
    pub profiles: ProfileStore,
    pub secrets: Arc<dyn SecretStore>,
    pub sessions: SessionManager<C>,
    pub client_version: VersionFn,
    pub settings_path: PathBuf,
}
