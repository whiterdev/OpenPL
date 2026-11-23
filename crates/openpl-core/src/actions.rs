//! Acciones sobre un objeto del explorador: DDL (DBMS_METADATA) y recompilar.

use crate::catalog::ObjectType;
use openpl_oracle::{DbConn, DbError};
use serde::Serialize;

/// Tipo de objeto para `DBMS_METADATA.GET_DDL`; `None` si no tiene DDL obtenible.
pub fn ddl_kind(t: ObjectType) -> Option<&'static str> {
    use ObjectType::*;
    Some(match t {
        Package => "PACKAGE",
        Procedure => "PROCEDURE",
        Function => "FUNCTION",
        Trigger => "TRIGGER",
        Type => "TYPE",
        JavaSource => "JAVA_SOURCE",
        Queue => "AQ_QUEUE",
        QueueTable => "AQ_QUEUE_TABLE",
        Library => "LIBRARY",
        Directory => "DIRECTORY",
        Table => "TABLE",
        Index => "INDEX",
        Constraint => "CONSTRAINT",
        View => "VIEW",
        MaterializedView => "MATERIALIZED_VIEW",
        Sequence => "SEQUENCE",
        User => "USER",
        Profile => "PROFILE",
        Role => "ROLE",
        Synonym => "SYNONYM",
        DatabaseLink => "DB_LINK",
        Tablespace => "TABLESPACE",
        Cluster => "CLUSTER",
        WindowGroup | Window | Schedule | Program | Chain | Job | JobClass | Credential
        | FileWatcher => "PROCOBJ",
        JavaClass | DbmsJob | RecycleBin => return None,
    })
}

/// Objetos sin esquema: GET_DDL se llama sin dueño.
pub fn ddl_uses_schema(t: ObjectType) -> bool {
    !matches!(
        t,
        ObjectType::User
            | ObjectType::Role
            | ObjectType::Profile
            | ObjectType::Tablespace
            | ObjectType::Directory
    )
}

fn quote(id: &str) -> String {
    format!("\"{}\"", id.replace('"', "\"\""))
}

/// Sentencia para recompilar el objeto; `None` si el tipo no se compila.
pub fn recompile_sql(t: ObjectType, owner: &str, name: &str) -> Option<String> {
    let (kind, verb) = match t {
        ObjectType::Package => ("PACKAGE", "COMPILE"),
        ObjectType::Procedure => ("PROCEDURE", "COMPILE"),
        ObjectType::Function => ("FUNCTION", "COMPILE"),
        ObjectType::Trigger => ("TRIGGER", "COMPILE"),
        ObjectType::Type => ("TYPE", "COMPILE"),
        ObjectType::View => ("VIEW", "COMPILE"),
        ObjectType::MaterializedView => ("MATERIALIZED VIEW", "COMPILE"),
        ObjectType::JavaSource => ("JAVA SOURCE", "COMPILE"),
        ObjectType::JavaClass => ("JAVA CLASS", "RESOLVE"),
        _ => return None,
    };
    Some(format!(
        "ALTER {kind} {}.{} {verb}",
        quote(owner),
        quote(name)
    ))
}

/// DDL completo del objeto, con `;` al final de cada sentencia.
pub fn get_ddl(conn: &DbConn, t: ObjectType, owner: &str, name: &str) -> Result<String, DbError> {
    let kind =
        ddl_kind(t).ok_or_else(|| DbError::from_code(None, "Este tipo de objeto no tiene DDL."))?;
    let c = conn.raw();
    c.execute(
        "BEGIN DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE); \
         DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'PRETTY', TRUE); END;",
        &[],
    )?;
    let fetch = |k: &str| -> Result<String, DbError> {
        let ddl: String = if ddl_uses_schema(t) {
            c.query_row_as(
                "SELECT DBMS_METADATA.GET_DDL(:1, :2, :3) FROM dual",
                &[&k, &name, &owner],
            )?
        } else {
            c.query_row_as(
                "SELECT DBMS_METADATA.GET_DDL(:1, :2) FROM dual",
                &[&k, &name],
            )?
        };
        Ok(ddl.trim().to_string())
    };
    match fetch(kind) {
        // Las claves foráneas se piden como REF_CONSTRAINT.
        Err(e) if t == ObjectType::Constraint && e.code.as_deref() == Some("ORA-31603") => {
            fetch("REF_CONSTRAINT")
        }
        r => r,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RecompileResult {
    /// true si compiló con errores (ORA-24344).
    pub with_errors: bool,
}

pub fn recompile(
    conn: &DbConn,
    t: ObjectType,
    owner: &str,
    name: &str,
) -> Result<RecompileResult, DbError> {
    let sql = recompile_sql(t, owner, name)
        .ok_or_else(|| DbError::from_code(None, "Este tipo de objeto no se recompila."))?;
    match conn.raw().execute(&sql, &[]) {
        Ok(_) => Ok(RecompileResult { with_errors: false }),
        Err(e) => {
            let e = DbError::from(e);
            if e.code.as_deref() == Some("ORA-24344") {
                Ok(RecompileResult { with_errors: true })
            } else {
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tipos_con_ddl() {
        assert_eq!(ddl_kind(ObjectType::Package), Some("PACKAGE"));
        assert_eq!(
            ddl_kind(ObjectType::MaterializedView),
            Some("MATERIALIZED_VIEW")
        );
        assert_eq!(ddl_kind(ObjectType::DatabaseLink), Some("DB_LINK"));
        assert_eq!(ddl_kind(ObjectType::Job), Some("PROCOBJ"));
        assert_eq!(ddl_kind(ObjectType::QueueTable), Some("AQ_QUEUE_TABLE"));
        assert_eq!(ddl_kind(ObjectType::DbmsJob), None);
        assert_eq!(ddl_kind(ObjectType::RecycleBin), None);
    }

    #[test]
    fn ddl_sin_esquema_para_objetos_globales() {
        assert!(!ddl_uses_schema(ObjectType::User));
        assert!(!ddl_uses_schema(ObjectType::Tablespace));
        assert!(ddl_uses_schema(ObjectType::Table));
    }

    #[test]
    fn recompilar_codigo_y_vistas() {
        assert_eq!(
            recompile_sql(ObjectType::Package, "HR", "PKG_A").as_deref(),
            Some("ALTER PACKAGE \"HR\".\"PKG_A\" COMPILE")
        );
        assert_eq!(
            recompile_sql(ObjectType::View, "HR", "V1").as_deref(),
            Some("ALTER VIEW \"HR\".\"V1\" COMPILE")
        );
        assert_eq!(
            recompile_sql(ObjectType::JavaClass, "HR", "a/B").as_deref(),
            Some("ALTER JAVA CLASS \"HR\".\"a/B\" RESOLVE")
        );
        assert_eq!(recompile_sql(ObjectType::Table, "HR", "T"), None);
    }

    #[test]
    fn identificadores_con_comillas_se_escapan() {
        assert_eq!(
            recompile_sql(ObjectType::Procedure, "HR", "raro\"x").as_deref(),
            Some("ALTER PROCEDURE \"HR\".\"raro\"\"x\" COMPILE")
        );
    }
}
