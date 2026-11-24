//! Parámetros de conexión y conexión a Oracle.

use crate::{DbError, DbVersion, ErrorKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Role {
    Normal,
    SysDba,
    SysOper,
}

#[derive(Clone, Deserialize)]
pub struct ConnectParams {
    pub user: String,
    pub password: String,
    pub db: String,
    pub role: Role,
}

impl std::fmt::Debug for ConnectParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectParams")
            .field("user", &self.user)
            .field("password", &"***")
            .field("db", &self.db)
            .field("role", &self.role)
            .finish()
    }
}

/// Conexión abierta con la versión del servidor ya leída.
pub struct DbConn {
    conn: std::sync::Arc<oracle::Connection>,
    server_version: DbVersion,
}

impl DbConn {
    pub fn connect(p: &ConnectParams) -> Result<DbConn, DbError> {
        let mut connector = oracle::Connector::new(&p.user, &p.password, &p.db);
        match p.role {
            Role::Normal => {}
            Role::SysDba => {
                connector.privilege(oracle::Privilege::Sysdba);
            }
            Role::SysOper => {
                connector.privilege(oracle::Privilege::Sysoper);
            }
        }
        let conn = connector.connect().map_err(|e| {
            let mut err = DbError::from(e);
            if err.kind == ErrorKind::UnknownService {
                err.message = format!(
                    "No se encontró la base de datos '{}' o su listener: revise el alias TNS o host:puerto/servicio.",
                    p.db
                );
            }
            err
        })?;
        let (v, _) = conn.server_version()?;
        let server_version = DbVersion::new(v.major() as u32, v.minor() as u32, v.update() as u32);
        Ok(DbConn {
            conn: std::sync::Arc::new(conn),
            server_version,
        })
    }

    pub fn server_version(&self) -> DbVersion {
        self.server_version
    }

    pub fn raw(&self) -> &oracle::Connection {
        &self.conn
    }

    /// Referencia compartida para operaciones permitidas desde otro hilo (`break_execution`).
    pub fn shared(&self) -> std::sync::Arc<oracle::Connection> {
        self.conn.clone()
    }

    pub fn ping(&self) -> Result<(), DbError> {
        self.conn.ping()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_oculta_password() {
        let p = ConnectParams {
            user: "hr".into(),
            password: "s3cr3t".into(),
            db: "dev".into(),
            role: Role::Normal,
        };
        assert!(!format!("{p:?}").contains("s3cr3t"));
    }
}
