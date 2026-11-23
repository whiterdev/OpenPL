//! Catálogo contra una base real (solo lectura). Requiere OPENPL_TEST_USER/PASSWORD/DB.

use openpl_core::catalog::{list_objects, ObjectType, Scope};
use openpl_oracle::{ConnectParams, DbConn, Role};

fn conn() -> Option<DbConn> {
    let get = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    match (
        get("OPENPL_TEST_USER"),
        get("OPENPL_TEST_PASSWORD"),
        get("OPENPL_TEST_DB"),
    ) {
        (Some(user), Some(password), Some(db)) => Some(
            DbConn::connect(&ConnectParams {
                user,
                password,
                db,
                role: Role::Normal,
            })
            .unwrap(),
        ),
        _ => {
            eprintln!("SKIP: OPENPL_TEST_* no definidas");
            None
        }
    }
}

#[test]
fn lista_tablas_propias_sin_error() {
    let Some(c) = conn() else { return };
    let v = list_objects(&c, Scope::Mine, ObjectType::Table, None).unwrap();
    assert!(v.iter().all(|o| o.object_type == ObjectType::Table));
}

#[test]
fn todos_los_tipos_consultan_sin_error() {
    let Some(c) = conn() else { return };
    for t in ObjectType::ALL {
        list_objects(&c, Scope::Mine, t, Some("A")).unwrap();
    }
}
