//! Errores del núcleo, serializables hacia la interfaz.

use openpl_oracle::DbError;
use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
pub enum CoreError {
    #[error("Error de archivo: {0}")]
    Io(String),
    #[error("Archivo de configuración inválido: {0}")]
    Json(String),
    #[error("Almacén de contraseñas: {0}")]
    Secret(String),
    #[error("{0}")]
    Db(#[from] DbError),
    #[error("La sesión no existe.")]
    SessionNotFound,
    #[error("Sesión desconectada.")]
    Disconnected,
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        CoreError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Json(e.to_string())
    }
}
