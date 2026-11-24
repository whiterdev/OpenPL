//! Errores de base de datos con código Oracle y categoría útil para la interfaz.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorKind {
    ClientMissing,
    InvalidCredentials,
    PasswordExpired,
    UnknownService,
    ConnectionLost,
    Other,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct DbError {
    /// Código como `"ORA-01017"` o `"DPI-1047"`.
    pub code: Option<String>,
    pub kind: ErrorKind,
    pub message: String,
    /// Posición del error dentro de la sentencia (base 0), si Oracle la informa.
    pub offset: Option<u32>,
}

/// Categoriza un código Oracle/ODPI.
pub fn classify(code: &str) -> ErrorKind {
    match code {
        "DPI-1047" | "DPI-1072" => ErrorKind::ClientMissing,
        "ORA-01017" | "ORA-01005" | "ORA-01045" => ErrorKind::InvalidCredentials,
        "ORA-28001" => ErrorKind::PasswordExpired,
        "ORA-12154" | "ORA-12514" | "ORA-12541" | "ORA-12505" | "ORA-12545" | "ORA-12170" => {
            ErrorKind::UnknownService
        }
        "ORA-03113" | "ORA-03114" | "ORA-03135" | "ORA-02396" | "ORA-00028" | "ORA-01012"
        | "ORA-12537" | "ORA-12547" | "ORA-12571" | "DPI-1080" | "DPI-1010" => {
            ErrorKind::ConnectionLost
        }
        _ => ErrorKind::Other,
    }
}

/// Obtiene el código a partir de un error de OCI (número) o del texto `DPI-NNNN`.
pub(crate) fn error_code(is_oci: bool, number: i32, message: &str) -> Option<String> {
    if is_oci && number > 0 {
        return Some(format!("ORA-{number:05}"));
    }
    for prefix in ["DPI-", "ORA-"] {
        if let Some(pos) = message.find(prefix) {
            let digits: String = message[pos + 4..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if digits.len() >= 4 {
                return Some(format!("{prefix}{digits}"));
            }
        }
    }
    None
}

impl DbError {
    /// Construye el error con un mensaje corto en español para los casos comunes.
    pub fn from_code(code: Option<String>, original: &str) -> Self {
        let kind = code.as_deref().map(classify).unwrap_or(ErrorKind::Other);
        let message = match kind {
            ErrorKind::InvalidCredentials => "Usuario o contraseña incorrectos.".to_string(),
            ErrorKind::PasswordExpired => {
                "La contraseña expiró; cámbiela con otra herramienta.".to_string()
            }
            ErrorKind::ClientMissing if code.as_deref() == Some("DPI-1072") => {
                "La versión del cliente Oracle no es compatible; instale Instant Client 19 o 21."
                    .to_string()
            }
            ErrorKind::ClientMissing => {
                // El detalle original distingue "no encontrado" de "arquitectura incorrecta".
                format!("No se encontró Oracle Instant Client (64 bits). {original}")
            }
            _ => original.to_string(),
        };
        Self {
            code,
            kind,
            message,
            offset: None,
        }
    }
}

impl From<oracle::Error> for DbError {
    fn from(e: oracle::Error) -> Self {
        let text = e.to_string();
        let (is_oci, number, offset) = match e.db_error() {
            Some(db) => (
                e.kind() == oracle::ErrorKind::OciError,
                db.code(),
                Some(db.offset()).filter(|&o| o > 0),
            ),
            None => (false, 0, None),
        };
        let mut error = Self::from_code(error_code(is_oci, number, &text), &text);
        error.offset = offset;
        error
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cliente_de_otra_arquitectura_conserva_el_detalle() {
        let e = DbError::from_code(
            Some("DPI-1047".into()),
            "DPI-1047: Cannot locate a 64-bit Oracle Client library: \"oci.dll is not the correct architecture\"",
        );
        assert_eq!(e.kind, ErrorKind::ClientMissing);
        assert!(e
            .message
            .starts_with("No se encontró Oracle Instant Client (64 bits)."));
        assert!(e.message.contains("not the correct architecture"));
    }

    #[test]
    fn cliente_de_version_no_soportada_no_dice_no_encontrado() {
        let e = DbError::from_code(
            Some("DPI-1072".into()),
            "DPI-1072: the Oracle Client library version is unsupported",
        );
        assert!(!e.message.contains("No se encontró"));
        assert!(e.message.contains("no es compatible"));
    }

    #[test]
    fn mas_codigos_de_conexion_perdida() {
        for c in ["ORA-01012", "ORA-12537", "ORA-12547", "ORA-12571"] {
            assert_eq!(classify(c), ErrorKind::ConnectionLost, "{c}");
        }
    }

    #[test]
    fn clave_expirada_indica_que_hacer() {
        let e = DbError::from_code(
            Some("ORA-28001".into()),
            "ORA-28001: the password has expired",
        );
        assert_eq!(
            e.message,
            "La contraseña expiró; cámbiela con otra herramienta."
        );
    }

    #[test]
    fn clasifica_codigos() {
        assert_eq!(classify("DPI-1047"), ErrorKind::ClientMissing);
        assert_eq!(classify("ORA-01017"), ErrorKind::InvalidCredentials);
        assert_eq!(classify("ORA-28001"), ErrorKind::PasswordExpired);
        assert_eq!(classify("ORA-12154"), ErrorKind::UnknownService);
        assert_eq!(classify("ORA-12514"), ErrorKind::UnknownService);
        assert_eq!(classify("ORA-12541"), ErrorKind::UnknownService);
        for c in [
            "ORA-03113",
            "ORA-03114",
            "ORA-03135",
            "ORA-02396",
            "DPI-1080",
            "DPI-1010",
        ] {
            assert_eq!(classify(c), ErrorKind::ConnectionLost, "{c}");
        }
        assert_eq!(classify("ORA-00942"), ErrorKind::Other);
    }

    #[test]
    fn codigo_ora_desde_numero() {
        assert_eq!(
            error_code(true, 1017, "ORA-01017: invalid username/password"),
            Some("ORA-01017".into())
        );
    }

    #[test]
    fn codigo_dpi_desde_mensaje() {
        assert_eq!(
            error_code(
                false,
                0,
                "DPI-1047: Cannot locate a 64-bit Oracle Client library"
            ),
            Some("DPI-1047".into())
        );
    }

    #[test]
    fn sin_codigo_reconocible() {
        assert_eq!(error_code(false, 0, "algo raro"), None);
    }

    #[test]
    fn mensaje_amigable_por_tipo() {
        let e = DbError::from_code(
            Some("ORA-01017".into()),
            "ORA-01017: invalid username/password; logon denied",
        );
        assert_eq!(e.kind, ErrorKind::InvalidCredentials);
        assert_eq!(e.message, "Usuario o contraseña incorrectos.");
        let o = DbError::from_code(
            Some("ORA-00942".into()),
            "ORA-00942: table or view does not exist",
        );
        assert_eq!(o.message, "ORA-00942: table or view does not exist");
    }
}
