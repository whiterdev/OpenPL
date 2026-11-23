//! Pruebas contra una base real. Requieren OPENPL_TEST_USER, OPENPL_TEST_PASSWORD y OPENPL_TEST_DB;
//! si falta alguna, cada prueba imprime SKIP y termina sin fallar. Solo leen.

use openpl_oracle::{ConnectParams, DbConn, DbVersion, ErrorKind, Role};

fn params() -> Option<ConnectParams> {
    let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    match (get("OPENPL_TEST_USER"), get("OPENPL_TEST_PASSWORD"), get("OPENPL_TEST_DB")) {
        (Some(user), Some(password), Some(db)) => Some(ConnectParams { user, password, db, role: Role::Normal }),
        _ => {
            eprintln!("SKIP: OPENPL_TEST_* no definidas");
            None
        }
    }
}

#[test]
fn conecta_y_lee_version() {
    let Some(p) = params() else { return };
    let c = DbConn::connect(&p).unwrap();
    assert!(c.server_version() >= DbVersion::new(12, 1, 0));
    c.ping().unwrap();
}

#[test]
fn clave_erronea_da_invalid_credentials() {
    let Some(mut p) = params() else { return };
    p.password = "clave-que-no-existe-xyz".into();
    let e = DbConn::connect(&p).err().unwrap();
    assert_eq!(e.kind, ErrorKind::InvalidCredentials);
    assert_eq!(e.code.as_deref(), Some("ORA-01017"));
}

#[test]
fn servicio_inexistente_da_unknown_service() {
    let Some(mut p) = params() else { return };
    p.db = "127.0.0.1:1/no_existe".into();
    assert_eq!(DbConn::connect(&p).err().unwrap().kind, ErrorKind::UnknownService);
}
