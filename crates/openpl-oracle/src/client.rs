//! Detección e inicialización del cliente Oracle (Instant Client).

use crate::{DbError, DbVersion};
use std::path::Path;

/// Inicializa ODPI-C. Llamar una sola vez, antes de cualquier otro uso.
/// Con `Some(dir)` carga el cliente desde esa carpeta; con `None` usa `PATH`/`LD_LIBRARY_PATH`.
pub fn init_client(lib_dir: Option<&Path>) -> Result<(), DbError> {
    let mut params = oracle::InitParams::new();
    if let Some(dir) = lib_dir {
        params.oracle_client_lib_dir(dir)?;
    }
    params.init()?;
    Ok(())
}

/// Versión del cliente Oracle cargado.
pub fn client_version() -> Result<DbVersion, DbError> {
    let v = oracle::Version::client()?;
    Ok(DbVersion::new(
        v.major() as u32,
        v.minor() as u32,
        v.update() as u32,
    ))
}

/// Ayuda breve para configurar el cliente según el sistema operativo.
pub fn client_help() -> &'static str {
    if cfg!(windows) {
        "Instale Oracle Instant Client 19 o 21 de 64 bits y agregue su carpeta al PATH, o indíquela en Preferencias."
    } else {
        "Instale Oracle Instant Client 19 o 21 de 64 bits y agregue su carpeta a LD_LIBRARY_PATH (o ldconfig), o indíquela en Preferencias."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ayuda_menciona_variable_de_entorno() {
        let h = client_help();
        if cfg!(windows) {
            assert!(h.contains("PATH"))
        } else {
            assert!(h.contains("LD_LIBRARY_PATH"))
        }
        assert!(h.contains("19") && h.contains("21") && h.contains("64 bits"));
    }
}
