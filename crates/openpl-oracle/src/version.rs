//! Versiones de cliente/servidor Oracle y reglas de compatibilidad.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct DbVersion {
    pub major: u32,
    pub minor: u32,
    pub update: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "reason")]
pub enum Compat {
    Supported,
    Warn(String),
    Unsupported(String),
}

impl DbVersion {
    pub const fn new(major: u32, minor: u32, update: u32) -> Self {
        Self {
            major,
            minor,
            update,
        }
    }
}

impl std::fmt::Display for DbVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.update)
    }
}

const MIN_SERVER: DbVersion = DbVersion::new(12, 1, 0);

/// Decide si la combinación cliente/servidor es soportada por OpenPL.
pub fn check_compat(client: DbVersion, server: DbVersion) -> Compat {
    if server < MIN_SERVER {
        return Compat::Unsupported(format!(
            "OpenPL requiere Oracle 12.1 o superior; el servidor es {server}."
        ));
    }
    if client.major >= 23 && server.major < 19 {
        return Compat::Unsupported(format!(
            "Instant Client {} no puede conectar a Oracle {server}. Instale Instant Client 19 o 21.",
            client.major
        ));
    }
    if (client.major == 12 && client >= MIN_SERVER) || (19..=21).contains(&client.major) {
        return Compat::Supported;
    }
    Compat::Warn(format!(
        "Instant Client {} no está probado con OpenPL; se recomienda 19 o 21.",
        client.major
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ic19_con_12_1_soportado() {
        assert_eq!(
            check_compat(DbVersion::new(19, 3, 0), DbVersion::new(12, 1, 0)),
            Compat::Supported
        );
    }

    #[test]
    fn ic21_con_19_soportado() {
        assert_eq!(
            check_compat(DbVersion::new(21, 13, 0), DbVersion::new(19, 0, 0)),
            Compat::Supported
        );
    }

    #[test]
    fn servidor_11g_no_soportado() {
        assert!(matches!(
            check_compat(DbVersion::new(19, 3, 0), DbVersion::new(11, 2, 0)),
            Compat::Unsupported(_)
        ));
    }

    #[test]
    fn ic23_con_servidor_12c_no_soportado() {
        let c = check_compat(DbVersion::new(23, 4, 0), DbVersion::new(12, 2, 0));
        assert_eq!(
            c,
            Compat::Unsupported(
                "Instant Client 23 no puede conectar a Oracle 12.2.0. Instale Instant Client 19 o 21.".into()
            )
        );
    }

    #[test]
    fn ic23_con_servidor_19_advertencia() {
        assert!(matches!(
            check_compat(DbVersion::new(23, 4, 0), DbVersion::new(19, 0, 0)),
            Compat::Warn(_)
        ));
    }

    #[test]
    fn cliente_12_1_soportado() {
        assert_eq!(
            check_compat(DbVersion::new(12, 1, 0), DbVersion::new(12, 1, 0)),
            Compat::Supported
        );
    }

    #[test]
    fn display_version() {
        assert_eq!(DbVersion::new(19, 3, 0).to_string(), "19.3.0");
    }
}
