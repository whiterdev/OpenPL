//! Pruebas contra Oracle con OPENPL_TEST_USER/PASSWORD/DB.
//! La prueba de ventana SQL usa DBMS_OUTPUT y queda fuera de las corridas de solo lectura.

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
fn lee_firma_sin_ejecutar_la_rutina() {
    let Some(c) = conn() else { return };
    let signatures =
        openpl_core::routine::list_overloads(&c, "SYS", Some("DBMS_OUTPUT"), "PUT_LINE").unwrap();
    assert_eq!(signatures.len(), 1);
    assert_eq!(signatures[0].parameters.len(), 1);
    assert!(signatures[0].returns.is_none());
}

#[test]
fn todos_los_tipos_consultan_sin_error() {
    let Some(c) = conn() else { return };
    for t in ObjectType::ALL {
        list_objects(&c, Scope::Mine, t, Some("A")).unwrap();
    }
}

#[test]
fn completa_objetos_y_columnas_sin_error() {
    let Some(c) = conn() else { return };
    let objects = openpl_core::catalog::complete_objects(&c, None, "", None).unwrap();
    assert!(objects.len() <= openpl_core::catalog::COMPLETION_LIMIT);
    openpl_core::catalog::object_columns(&c, None, "DUAL", None).unwrap();
}

#[test]
fn ventana_sql_pagina_salida_y_errores() {
    use openpl_core::sql::{execute, fetch, ExecResult};
    let Some(c) = conn() else { return };
    let r = execute(&c, "SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 5", &[], 2).unwrap();
    let ExecResult::Query {
        cursor,
        columns,
        page,
    } = r.result
    else {
        panic!("se esperaba consulta")
    };
    assert_eq!(columns[0].name, "N");
    assert!(columns[0].numeric);
    assert_eq!(page.rows.len(), 2);
    assert!(page.more);
    let rest = fetch(cursor, 10).unwrap();
    assert_eq!(rest.rows.len(), 3);
    assert!(!rest.more);

    openpl_core::sql::enable_output(&c).unwrap();
    let r = execute(&c, "BEGIN DBMS_OUTPUT.PUT_LINE('hola'); END;", &[], 10).unwrap();
    assert_eq!(r.output, vec!["hola".to_string()]);
    assert!(!r.transaction);

    let e = execute(&c, "SELECT * FROM tabla_que_no_existe_openpl", &[], 10)
        .err()
        .unwrap();
    assert_eq!(e.code.as_deref(), Some("ORA-00942"));
    assert_eq!(e.offset, Some(14));
}

#[test]
fn edicion_en_grilla_solo_resuelve_tablas() {
    let Some(c) = conn() else { return };
    // Solo lectura: DUAL es una tabla de SYS visible por sinónimo público; no se aplica nada.
    let target = openpl_core::grid::edit_target(&c, None, "DUAL").unwrap();
    if let Some(t) = target {
        assert_eq!(t.name, "DUAL");
        assert!(t.columns.iter().any(|col| col.name == "DUMMY"));
    }
    assert!(openpl_core::grid::edit_target(&c, None, "NO_EXISTE_OPENPL")
        .unwrap()
        .is_none());
}
