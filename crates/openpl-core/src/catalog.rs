//! Catálogo de objetos del esquema (explorador).

use openpl_oracle::{DbConn, DbError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ObjectType {
    Package,
    Procedure,
    Function,
    Trigger,
    Type,
    JavaSource,
    JavaClass,
    DbmsJob,
    Queue,
    QueueTable,
    Library,
    Directory,
    Table,
    Index,
    Constraint,
    View,
    MaterializedView,
    Sequence,
    User,
    Profile,
    Role,
    Synonym,
    DatabaseLink,
    Tablespace,
    Cluster,
    WindowGroup,
    Window,
    Schedule,
    Program,
    Chain,
    Job,
    JobClass,
    Credential,
    FileWatcher,
    RecycleBin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Scope {
    Mine,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ObjectStatus {
    Valid,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ObjectInfo {
    pub owner: String,
    pub name: String,
    pub object_type: ObjectType,
    pub status: ObjectStatus,
    /// ISO-8601, p. ej. `2024-05-01T10:00:00`.
    pub last_ddl_time: String,
}

pub struct RawRow {
    pub owner: String,
    pub name: String,
    pub oracle_type: String,
    pub status: String,
    pub last_ddl_time: String,
}

impl ObjectType {
    /// Orden del árbol del explorador.
    pub const ALL: [ObjectType; 35] = [
        ObjectType::Package,
        ObjectType::Procedure,
        ObjectType::Function,
        ObjectType::Trigger,
        ObjectType::Type,
        ObjectType::JavaSource,
        ObjectType::JavaClass,
        ObjectType::DbmsJob,
        ObjectType::Queue,
        ObjectType::QueueTable,
        ObjectType::Library,
        ObjectType::Directory,
        ObjectType::Table,
        ObjectType::Index,
        ObjectType::Constraint,
        ObjectType::View,
        ObjectType::MaterializedView,
        ObjectType::Sequence,
        ObjectType::User,
        ObjectType::Profile,
        ObjectType::Role,
        ObjectType::Synonym,
        ObjectType::DatabaseLink,
        ObjectType::Tablespace,
        ObjectType::Cluster,
        ObjectType::WindowGroup,
        ObjectType::Window,
        ObjectType::Schedule,
        ObjectType::Program,
        ObjectType::Chain,
        ObjectType::Job,
        ObjectType::JobClass,
        ObjectType::Credential,
        ObjectType::FileWatcher,
        ObjectType::RecycleBin,
    ];

    /// Tipos de ALL_OBJECTS que representa (vacío si usa una consulta propia).
    pub fn oracle_types(self) -> &'static [&'static str] {
        match self {
            ObjectType::Package => &["PACKAGE", "PACKAGE BODY"],
            ObjectType::Procedure => &["PROCEDURE"],
            ObjectType::Function => &["FUNCTION"],
            ObjectType::Trigger => &["TRIGGER"],
            ObjectType::Type => &["TYPE", "TYPE BODY"],
            ObjectType::JavaSource => &["JAVA SOURCE"],
            ObjectType::JavaClass => &["JAVA CLASS"],
            ObjectType::Queue => &["QUEUE"],
            ObjectType::Library => &["LIBRARY"],
            ObjectType::Directory => &["DIRECTORY"],
            ObjectType::Table => &["TABLE"],
            ObjectType::Index => &["INDEX"],
            ObjectType::View => &["VIEW"],
            ObjectType::MaterializedView => &["MATERIALIZED VIEW"],
            ObjectType::Sequence => &["SEQUENCE"],
            ObjectType::Synonym => &["SYNONYM"],
            ObjectType::DatabaseLink => &["DATABASE LINK"],
            ObjectType::Cluster => &["CLUSTER"],
            ObjectType::WindowGroup => &["WINDOW GROUP", "SCHEDULER GROUP"],
            ObjectType::Window => &["WINDOW"],
            ObjectType::Schedule => &["SCHEDULE"],
            ObjectType::Program => &["PROGRAM"],
            ObjectType::Chain => &["CHAIN"],
            ObjectType::Job => &["JOB"],
            ObjectType::JobClass => &["JOB CLASS"],
            ObjectType::Credential => &["CREDENTIAL"],
            ObjectType::FileWatcher => &["FILE WATCHER"],
            _ => &[],
        }
    }

    /// Objetos de SYS compartidos por todos: "Míos" no filtra por dueño.
    fn is_global(self) -> bool {
        matches!(
            self,
            ObjectType::Directory
                | ObjectType::Window
                | ObjectType::WindowGroup
                | ObjectType::JobClass
        )
    }
}

/// Consulta propia para tipos que no salen de ALL_OBJECTS.
/// Columnas: dueño, nombre, tipo, estado ('VALID'/'INVALID'), fecha ISO (`ISO` se reemplaza).
struct Custom {
    select: &'static str,
    from_where: &'static str,
    owner_col: Option<&'static str>,
    name_col: &'static str,
    order: &'static str,
}

const ISO_FMT: &str = "'YYYY-MM-DD\"T\"HH24:MI:SS'";
const NO_OWNER: &str = "CAST(NULL AS VARCHAR2(1))";
const NO_DATE: &str = "CAST(NULL AS VARCHAR2(19))";

fn custom(t: ObjectType) -> Option<Custom> {
    let c = |select, from_where, owner_col, name_col, order| Custom {
        select,
        from_where,
        owner_col,
        name_col,
        order,
    };
    Some(match t {
        ObjectType::Constraint => c(
            "owner, constraint_name, 'CONSTRAINT', 'VALID', TO_CHAR(last_change, ISO)",
            "FROM all_constraints WHERE constraint_type IN ('P','U','R','C') AND constraint_name NOT LIKE 'BIN$%'",
            Some("owner"),
            "constraint_name",
            "owner, constraint_name",
        ),
        ObjectType::DbmsJob => c(
            "schema_user, TO_CHAR(job), 'JOB', CASE broken WHEN 'Y' THEN 'INVALID' ELSE 'VALID' END, TO_CHAR(last_date, ISO)",
            "FROM all_jobs WHERE 1 = 1",
            Some("schema_user"),
            "TO_CHAR(job)",
            "schema_user, job",
        ),
        ObjectType::QueueTable => c(
            "owner, queue_table, 'QUEUE TABLE', 'VALID', NO_DATE",
            "FROM all_queue_tables WHERE 1 = 1",
            Some("owner"),
            "queue_table",
            "owner, queue_table",
        ),
        ObjectType::User => c(
            "NO_OWNER, username, 'USER', 'VALID', TO_CHAR(created, ISO)",
            "FROM all_users WHERE 1 = 1",
            None,
            "username",
            "username",
        ),
        ObjectType::Role => c(
            "NO_OWNER, role, 'ROLE', 'VALID', NO_DATE",
            "FROM dba_roles WHERE 1 = 1",
            None,
            "role",
            "role",
        ),
        ObjectType::Profile => c(
            "DISTINCT NO_OWNER, profile, 'PROFILE', 'VALID', NO_DATE",
            "FROM dba_profiles WHERE 1 = 1",
            None,
            "profile",
            "profile",
        ),
        ObjectType::Tablespace => c(
            "NO_OWNER, tablespace_name, 'TABLESPACE', CASE status WHEN 'OFFLINE' THEN 'INVALID' ELSE 'VALID' END, NO_DATE",
            "FROM user_tablespaces WHERE 1 = 1",
            None,
            "tablespace_name",
            "tablespace_name",
        ),
        ObjectType::RecycleBin => c(
            "USER, original_name, type, 'VALID', REPLACE(droptime, ':', 'T')",
            "FROM user_recyclebin WHERE 1 = 1",
            None,
            "original_name",
            "droptime DESC",
        ),
        _ => return None,
    })
}

/// Alternativa sin privilegios de DBA (ORA-00942 / ORA-01031 en la consulta principal).
fn custom_fallback(t: ObjectType) -> Option<Custom> {
    let c = |select, from_where, name_col: &'static str| Custom {
        select,
        from_where,
        owner_col: None,
        name_col,
        order: name_col,
    };
    match t {
        ObjectType::Role => Some(c(
            "NO_OWNER, granted_role, 'ROLE', 'VALID', NO_DATE",
            "FROM user_role_privs WHERE 1 = 1",
            "granted_role",
        )),
        _ => None,
    }
}

/// `UPPER(col) LIKE :f` con `\`, `%` y `_` escapados: "contiene" literal.
fn push_filter(
    sql: &mut String,
    binds: &mut Vec<(String, String)>,
    col: &str,
    filter: Option<&str>,
) {
    if let Some(f) = filter.map(str::trim).filter(|f| !f.is_empty()) {
        let escaped: String = f
            .to_uppercase()
            .chars()
            .flat_map(|c| match c {
                '\\' | '%' | '_' => vec!['\\', c],
                _ => vec![c],
            })
            .collect();
        sql.push_str(&format!(" AND UPPER({col}) LIKE :f ESCAPE '\\'"));
        binds.push(("f".to_string(), format!("%{escaped}%")));
    }
}

fn custom_query(c: &Custom, scope: Scope, filter: Option<&str>) -> (String, Vec<(String, String)>) {
    let mut binds = Vec::new();
    let select = c
        .select
        .replace("NO_OWNER", NO_OWNER)
        .replace("NO_DATE", NO_DATE)
        .replace("ISO", ISO_FMT);
    let mut sql = format!("SELECT {select} {}", c.from_where);
    if let (Scope::Mine, Some(owner)) = (scope, c.owner_col) {
        sql.push_str(&format!(" AND {owner} = USER"));
    }
    push_filter(&mut sql, &mut binds, c.name_col, filter);
    sql.push_str(&format!(" ORDER BY {}", c.order));
    (sql, binds)
}

/// Consulta alternativa cuando la principal no tiene privilegios (solo algunos tipos).
pub fn fallback_query(
    scope: Scope,
    t: ObjectType,
    filter: Option<&str>,
) -> Option<(String, Vec<(String, String)>)> {
    custom_fallback(t).map(|c| custom_query(&c, scope, filter))
}

/// SQL y binds nombrados para listar objetos de un tipo. Compatible con Oracle 12.1.
pub fn objects_query(
    scope: Scope,
    t: ObjectType,
    filter: Option<&str>,
) -> (String, Vec<(String, String)>) {
    if let Some(c) = custom(t) {
        return custom_query(&c, scope, filter);
    }
    let mut binds = Vec::new();
    let mut placeholders = Vec::new();
    for (i, ot) in t.oracle_types().iter().enumerate() {
        let name = format!("t{i}");
        placeholders.push(format!(":{name}"));
        binds.push((name, ot.to_string()));
    }
    let mut sql = format!(
        "SELECT owner, object_name, object_type, status, TO_CHAR(last_ddl_time,'YYYY-MM-DD\"T\"HH24:MI:SS') \
         FROM all_objects WHERE object_type IN ({})",
        placeholders.join(", ")
    );
    if scope == Scope::Mine && !t.is_global() {
        sql.push_str(" AND owner = USER");
    }
    push_filter(&mut sql, &mut binds, "object_name", filter);
    sql.push_str(" AND object_name NOT LIKE 'BIN$%' ORDER BY owner, object_name");
    (sql, binds)
}

/// Agrupa spec/body (o type/type body) en un solo objeto; inválido si cualquiera lo es.
pub fn merge_status(t: ObjectType, rows: Vec<RawRow>) -> Vec<ObjectInfo> {
    let mut out: Vec<ObjectInfo> = Vec::with_capacity(rows.len());
    let mut index: std::collections::HashMap<(String, String), usize> =
        std::collections::HashMap::with_capacity(rows.len());
    for r in rows {
        let status = if r.status == "VALID" {
            ObjectStatus::Valid
        } else {
            ObjectStatus::Invalid
        };
        let key = (r.owner.clone(), r.name.clone());
        match index.get(&key).map(|&i| &mut out[i]) {
            Some(o) => {
                if status == ObjectStatus::Invalid {
                    o.status = ObjectStatus::Invalid;
                }
                if r.last_ddl_time > o.last_ddl_time {
                    o.last_ddl_time = r.last_ddl_time;
                }
            }
            None => {
                index.insert(key, out.len());
                out.push(ObjectInfo {
                    owner: r.owner,
                    name: r.name,
                    object_type: t,
                    status,
                    last_ddl_time: r.last_ddl_time,
                });
            }
        }
    }
    out
}

fn run_query(conn: &DbConn, sql: &str, binds: &[(String, String)]) -> Result<Vec<RawRow>, DbError> {
    let params: Vec<(&str, &dyn oracle::sql_type::ToSql)> = binds
        .iter()
        .map(|(k, v)| (k.as_str(), v as &dyn oracle::sql_type::ToSql))
        .collect();
    let rows = conn.raw().query_named(sql, &params)?;
    let text = |row: &oracle::Row, i: usize| -> Result<String, DbError> {
        Ok(row.get::<_, Option<String>>(i)?.unwrap_or_default())
    };
    let mut raw = Vec::new();
    for row in rows {
        let row = row?;
        raw.push(RawRow {
            owner: text(&row, 0)?,
            name: text(&row, 1)?,
            oracle_type: text(&row, 2)?,
            status: text(&row, 3)?,
            last_ddl_time: text(&row, 4)?,
        });
    }
    Ok(raw)
}

/// Lista objetos de un tipo desde la base. Sin acceso al catálogo, Perfiles queda vacío.
pub fn list_objects(
    conn: &DbConn,
    scope: Scope,
    t: ObjectType,
    filter: Option<&str>,
) -> Result<Vec<ObjectInfo>, DbError> {
    list_objects_with(scope, t, filter, |sql, binds| run_query(conn, sql, binds))
}

fn list_objects_with(
    scope: Scope,
    t: ObjectType,
    filter: Option<&str>,
    mut query: impl FnMut(&str, &[(String, String)]) -> Result<Vec<RawRow>, DbError>,
) -> Result<Vec<ObjectInfo>, DbError> {
    let (sql, binds) = objects_query(scope, t, filter);
    let raw = match query(&sql, &binds) {
        Ok(r) => r,
        Err(e) if matches!(e.code.as_deref(), Some("ORA-00942") | Some("ORA-01031")) => {
            if t == ObjectType::Profile {
                return Ok(Vec::new());
            }
            match fallback_query(scope, t, filter) {
                Some((fsql, fbinds)) => query(&fsql, &fbinds)?,
                None => return Err(e),
            }
        }
        Err(e) => return Err(e),
    };
    Ok(merge_status(t, raw))
}

const EDITOR_OBJECT_SQL: &str = "WITH requested AS (
    SELECT CAST(:1 AS VARCHAR2(4000)) AS requested_name,
           CAST(:2 AS VARCHAR2(4000)) AS explicit_owner,
           COALESCE(CAST(:3 AS VARCHAR2(4000)), SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')) AS context_owner
    FROM dual
), candidates AS (
    SELECT r.requested_name AS name, COALESCE(r.explicit_owner, r.context_owner) AS owner,
           CAST(NULL AS VARCHAR2(128)) AS db_link, 0 AS priority
    FROM requested r
    WHERE EXISTS (
        SELECT 1 FROM all_objects o WHERE o.object_name = r.requested_name
          AND o.owner = COALESCE(r.explicit_owner, r.context_owner)
          AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE',
                               'PACKAGE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'TYPE')
    )
    UNION ALL
    SELECT s.table_name, s.table_owner, s.db_link,
           CASE WHEN s.owner = 'PUBLIC' THEN 2 ELSE 1 END
    FROM all_synonyms s CROSS JOIN requested r
    WHERE s.synonym_name = r.requested_name
      AND (s.owner = COALESCE(r.explicit_owner, r.context_owner)
           OR (r.explicit_owner IS NULL AND s.owner = 'PUBLIC'))
), chosen AS (
    SELECT name, owner, db_link FROM (SELECT c.* FROM candidates c ORDER BY priority)
    WHERE ROWNUM = 1
)
SELECT o.owner, o.object_name, o.object_type, o.status,
       TO_CHAR(o.last_ddl_time, 'YYYY-MM-DD\"T\"HH24:MI:SS')
FROM all_objects o JOIN chosen c ON c.owner = o.owner AND c.name = o.object_name
WHERE c.db_link IS NULL AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE',
                                             'PACKAGE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'TYPE')
ORDER BY CASE o.object_type WHEN 'MATERIALIZED VIEW' THEN 0 WHEN 'TRIGGER' THEN 2 ELSE 1 END";

/// Busca nombres exactos y sinónimos de un salto, dentro de la misma base.
pub fn editor_object(
    conn: &DbConn,
    owner: Option<&str>,
    name: &str,
    context_owner: Option<&str>,
) -> Result<Option<ObjectInfo>, DbError> {
    let mut rows = conn
        .raw()
        .query_as::<(String, String, String, String, String)>(
            EDITOR_OBJECT_SQL,
            &[&name, &owner, &context_owner],
        )?;
    let Some((owner, name, oracle_type, status, last_ddl_time)) = rows.next().transpose()? else {
        return Ok(None);
    };
    Ok(ObjectType::ALL
        .iter()
        .find(|kind| kind.oracle_types().contains(&oracle_type.as_str()))
        .map(|&object_type| ObjectInfo {
            owner,
            name,
            object_type,
            status: if status == "VALID" {
                ObjectStatus::Valid
            } else {
                ObjectStatus::Invalid
            },
            last_ddl_time,
        }))
}

#[derive(Serialize)]
pub struct ObjectColumn {
    name: String,
    data_type: String,
    nullable: bool,
}

pub fn describe_columns(
    conn: &DbConn,
    owner: &str,
    name: &str,
) -> Result<Vec<ObjectColumn>, DbError> {
    conn.raw()
        .query_as::<(String, String, String)>(
            "SELECT column_name, data_type, nullable FROM all_tab_columns
             WHERE owner = :1 AND table_name = :2 ORDER BY column_id",
            &[&owner, &name],
        )?
        .map(|row| {
            let (name, data_type, nullable) = row?;
            Ok(ObjectColumn {
                name,
                data_type,
                nullable: nullable == "Y",
            })
        })
        .collect()
}

pub const COMPLETION_LIMIT: usize = 100;

/// Prefijo literal para `LIKE ... ESCAPE '\'`. El nombre llega ya normalizado.
pub fn completion_pattern(prefix: &str) -> String {
    let mut out: String = prefix
        .chars()
        .flat_map(|c| match c {
            '\\' | '%' | '_' => vec!['\\', c],
            _ => vec![c],
        })
        .collect();
    out.push('%');
    out
}

/// Qué objetos sugiere el completado: todos, o solo los que pueden ir tras FROM/JOIN.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompletionScope {
    #[default]
    Any,
    Relations,
}

const COMPLETE_ANY_TYPES: &str = "'TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'PACKAGE',
                            'PROCEDURE', 'FUNCTION', 'TYPE', 'SYNONYM'";
const COMPLETE_RELATION_TYPES: &str = "'TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SYNONYM'";

fn complete_objects_sql(scope: CompletionScope) -> String {
    let types = match scope {
        CompletionScope::Any => COMPLETE_ANY_TYPES,
        CompletionScope::Relations => COMPLETE_RELATION_TYPES,
    };
    COMPLETE_OBJECTS_SQL.replace("{types}", types)
}

const COMPLETE_OBJECTS_SQL: &str = "SELECT owner, object_name, object_type FROM (
    SELECT o.owner, o.object_name, o.object_type
    FROM all_objects o
    WHERE o.object_name LIKE :prefix ESCAPE '\\'
      AND o.object_name NOT LIKE 'BIN$%'
      AND o.object_type IN ({types})
      AND ((:owner IS NOT NULL AND o.owner = :owner)
           OR (:owner IS NULL
               AND (o.owner = COALESCE(CAST(:context AS VARCHAR2(4000)), SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'))
                    OR (o.owner = 'PUBLIC' AND o.object_type = 'SYNONYM'))))
    ORDER BY CASE WHEN o.owner = 'PUBLIC' THEN 1 ELSE 0 END, o.object_name,
             CASE o.object_type WHEN 'MATERIALIZED VIEW' THEN 0 ELSE 1 END
) WHERE ROWNUM <= 100";

#[derive(Serialize)]
pub struct CompletionObject {
    owner: String,
    name: String,
    object_type: String,
}

/// Objetos cuyo nombre empieza por `prefix`, del esquema indicado o del esquema de trabajo
/// más los sinónimos públicos. Devuelve como mucho `COMPLETION_LIMIT` filas.
pub fn complete_objects(
    conn: &DbConn,
    owner: Option<&str>,
    prefix: &str,
    context_owner: Option<&str>,
    scope: CompletionScope,
) -> Result<Vec<CompletionObject>, DbError> {
    let pattern = completion_pattern(prefix);
    let sql = complete_objects_sql(scope);
    let params: [(&str, &dyn oracle::sql_type::ToSql); 3] = [
        ("prefix", &pattern),
        ("owner", &owner),
        ("context", &context_owner),
    ];
    conn.raw()
        .query_named(&sql, &params)?
        .map(|row| {
            let row = row?;
            Ok(CompletionObject {
                owner: row.get(0)?,
                name: row.get(1)?,
                object_type: row.get(2)?,
            })
        })
        .collect()
}

pub fn has_columns(t: ObjectType) -> bool {
    matches!(
        t,
        ObjectType::Table | ObjectType::View | ObjectType::MaterializedView
    )
}

/// Columnas del objeto que resuelve el editor (nombre exacto o sinónimo local).
pub fn object_columns(
    conn: &DbConn,
    owner: Option<&str>,
    name: &str,
    context_owner: Option<&str>,
) -> Result<Vec<ObjectColumn>, DbError> {
    match editor_object(conn, owner, name, context_owner)? {
        Some(object) if has_columns(object.object_type) => {
            describe_columns(conn, &object.owner, &object.name)
        }
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patron_de_completado_es_prefijo_literal() {
        assert_eq!(completion_pattern("AB_C%"), r"AB\_C\%%");
        assert_eq!(completion_pattern(""), "%");
        assert_eq!(completion_pattern("Ventas 2026"), "Ventas 2026%");
    }

    #[test]
    fn completado_limita_filas_y_usa_binds() {
        for scope in [CompletionScope::Any, CompletionScope::Relations] {
            let sql = complete_objects_sql(scope);
            assert!(sql.contains("LIKE :prefix ESCAPE"));
            assert!(sql.contains(&format!("ROWNUM <= {COMPLETION_LIMIT}")));
            assert!(sql.contains("CAST(:context AS VARCHAR2(4000))"));
            assert!(!sql.contains("PACKAGE BODY"));
        }
    }

    #[test]
    fn completado_de_relaciones_solo_trae_tablas_vistas_y_sinonimos() {
        let sql = complete_objects_sql(CompletionScope::Relations);
        for t in ["'TABLE'", "'VIEW'", "'MATERIALIZED VIEW'", "'SYNONYM'"] {
            assert!(sql.contains(t), "falta {t}");
        }
        for t in ["PACKAGE", "PROCEDURE", "FUNCTION", "SEQUENCE", "'TYPE'"] {
            assert!(!sql.contains(t), "sobra {t}");
        }
    }

    #[test]
    fn completado_general_conserva_los_nueve_tipos() {
        let sql = complete_objects_sql(CompletionScope::Any);
        for t in [
            "'TABLE'",
            "'VIEW'",
            "'MATERIALIZED VIEW'",
            "'SEQUENCE'",
            "'PACKAGE'",
            "'PROCEDURE'",
            "'FUNCTION'",
            "'TYPE'",
            "'SYNONYM'",
        ] {
            assert!(sql.contains(t), "falta {t}");
        }
    }

    #[test]
    fn alcance_de_completado_se_lee_en_minusculas() {
        let any: CompletionScope = serde_json::from_str("\"any\"").unwrap();
        let rel: CompletionScope = serde_json::from_str("\"relations\"").unwrap();
        assert_eq!(any, CompletionScope::Any);
        assert_eq!(rel, CompletionScope::Relations);
        assert_eq!(CompletionScope::default(), CompletionScope::Any);
    }

    // Un bind NULL dentro de COALESCE o UNION ALL da ORA-12704 si no se tipa como VARCHAR2.
    #[test]
    fn binds_de_texto_en_coalesce_y_union_van_como_varchar2() {
        for bind in [":1", ":2", ":3"] {
            assert!(
                EDITOR_OBJECT_SQL.contains(&format!("CAST({bind} AS VARCHAR2(4000))")),
                "falta CAST en {bind}"
            );
        }
        for scope in [CompletionScope::Any, CompletionScope::Relations] {
            assert!(complete_objects_sql(scope).contains("CAST(:context AS VARCHAR2(4000))"));
        }
    }

    #[test]
    fn tipos_con_columnas() {
        assert!(has_columns(ObjectType::Table));
        assert!(has_columns(ObjectType::View));
        assert!(has_columns(ObjectType::MaterializedView));
        assert!(!has_columns(ObjectType::Package));
    }

    fn raw(owner: &str, name: &str, t: &str, status: &str) -> RawRow {
        raw_t(owner, name, t, status, "2024-01-01T00:00:00")
    }

    fn raw_t(owner: &str, name: &str, t: &str, status: &str, ddl: &str) -> RawRow {
        RawRow {
            owner: owner.into(),
            name: name.into(),
            oracle_type: t.into(),
            status: status.into(),
            last_ddl_time: ddl.into(),
        }
    }

    #[test]
    fn query_mine_usa_user_y_binds() {
        let (sql, binds) = objects_query(Scope::Mine, ObjectType::Procedure, None);
        assert!(sql.contains("FROM all_objects") && sql.contains("owner = USER"));
        assert!(sql.contains("object_type IN (:t0)"));
        assert_eq!(binds, vec![("t0".to_string(), "PROCEDURE".to_string())]);
    }

    #[test]
    fn query_package_incluye_body() {
        let (_, b) = objects_query(Scope::All, ObjectType::Package, None);
        assert_eq!(
            b.iter().map(|x| x.1.as_str()).collect::<Vec<_>>(),
            ["PACKAGE", "PACKAGE BODY"]
        );
    }

    #[test]
    fn query_all_no_filtra_por_usuario() {
        let (sql, _) = objects_query(Scope::All, ObjectType::Table, None);
        assert!(!sql.contains("owner = USER"));
    }

    #[test]
    fn filtro_escapa_comodines_y_es_contiene() {
        let (sql, b) = objects_query(Scope::Mine, ObjectType::Package, Some("pkg_v%"));
        assert!(sql.contains("UPPER(object_name) LIKE :f ESCAPE '\\'"));
        assert!(b.contains(&("f".to_string(), "%PKG\\_V\\%%".to_string())));
    }

    #[test]
    fn filtro_vacio_se_ignora() {
        let (sql, b) = objects_query(Scope::Mine, ObjectType::Table, Some("  "));
        assert!(!sql.contains(":f"));
        assert_eq!(b.len(), 1);
    }

    #[test]
    fn query_excluye_recyclebin_y_ordena() {
        let (sql, _) = objects_query(Scope::All, ObjectType::Table, None);
        assert!(
            sql.contains("object_name NOT LIKE 'BIN$%'")
                && sql.contains("ORDER BY owner, object_name")
        );
    }

    #[test]
    fn merge_package_invalido_si_body_invalido() {
        let rows = vec![
            raw("HR", "PKG_A", "PACKAGE", "VALID"),
            raw("HR", "PKG_A", "PACKAGE BODY", "INVALID"),
            raw("HR", "PKG_B", "PACKAGE", "VALID"),
        ];
        let out = merge_status(ObjectType::Package, rows);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].status, ObjectStatus::Invalid);
        assert_eq!(out[1].status, ObjectStatus::Valid);
    }

    #[test]
    fn merge_conserva_nombres_en_minusculas() {
        let out = merge_status(
            ObjectType::Table,
            vec![raw("HR", "mi_tabla", "TABLE", "VALID")],
        );
        assert_eq!(out[0].name, "mi_tabla");
    }

    #[test]
    fn merge_last_ddl_time_es_el_mayor() {
        let out = merge_status(
            ObjectType::Package,
            vec![
                raw_t("HR", "P", "PACKAGE", "VALID", "2024-01-01T00:00:00"),
                raw_t("HR", "P", "PACKAGE BODY", "VALID", "2024-05-01T00:00:00"),
            ],
        );
        assert_eq!(out[0].last_ddl_time, "2024-05-01T00:00:00");
    }

    #[test]
    fn el_arbol_tiene_todos_los_tipos() {
        assert_eq!(ObjectType::ALL.len(), 35);
        assert_eq!(ObjectType::ALL[0], ObjectType::Package);
        assert_eq!(*ObjectType::ALL.last().unwrap(), ObjectType::RecycleBin);
    }

    #[test]
    fn tipos_de_all_objects_nuevos() {
        let (sql, b) = objects_query(Scope::Mine, ObjectType::JavaSource, None);
        assert!(sql.contains("FROM all_objects") && sql.contains("owner = USER"));
        assert_eq!(b[0].1, "JAVA SOURCE");
        let (_, b) = objects_query(Scope::All, ObjectType::WindowGroup, None);
        let tipos: Vec<_> = b.iter().map(|x| x.1.as_str()).collect();
        assert!(tipos.contains(&"WINDOW GROUP") && tipos.contains(&"SCHEDULER GROUP"));
    }

    #[test]
    fn tipos_globales_ignoran_mios() {
        for t in [
            ObjectType::Directory,
            ObjectType::Window,
            ObjectType::JobClass,
        ] {
            let (sql, _) = objects_query(Scope::Mine, t, None);
            assert!(!sql.contains("owner = USER"), "{t:?}");
        }
    }

    #[test]
    fn usuarios_desde_all_users() {
        let (sql, _) = objects_query(Scope::Mine, ObjectType::User, Some("hr"));
        assert!(sql.contains("FROM all_users"));
        assert!(sql.contains("UPPER(username) LIKE :f"));
        assert!(!sql.contains("owner = USER"));
    }

    #[test]
    fn restricciones_por_dueno() {
        let (sql, _) = objects_query(Scope::Mine, ObjectType::Constraint, None);
        assert!(sql.contains("FROM all_constraints") && sql.contains("owner = USER"));
    }

    #[test]
    fn dbms_jobs_por_schema_user() {
        let (sql, _) = objects_query(Scope::Mine, ObjectType::DbmsJob, None);
        assert!(sql.contains("FROM all_jobs") && sql.contains("schema_user = USER"));
    }

    #[test]
    fn papelera_del_usuario() {
        let (sql, _) = objects_query(Scope::All, ObjectType::RecycleBin, None);
        assert!(sql.contains("FROM user_recyclebin"));
    }

    #[test]
    fn perfiles_sin_privilegios_devuelve_lista_vacia_sin_otro_select() {
        for code in ["ORA-00942", "ORA-01031"] {
            let mut calls = 0;
            let profiles =
                list_objects_with(Scope::Mine, ObjectType::Profile, Some("A"), |sql, _| {
                    calls += 1;
                    if calls > 1 {
                        return Err(DbError::from_code(
                            Some("ORA-00904".into()),
                            "PROFILE: invalid identifier",
                        ));
                    }
                    assert!(sql.contains("FROM dba_profiles"));
                    Err(DbError::from_code(
                        Some(code.into()),
                        "Sin acceso al catálogo",
                    ))
                });
            assert!(profiles.unwrap().is_empty());
            assert_eq!(calls, 1);
        }
    }

    #[test]
    fn perfiles_propaga_errores_ajenos_a_privilegios() {
        let result = list_objects_with(Scope::Mine, ObjectType::Profile, None, |_, _| {
            Err(DbError::from_code(
                Some("ORA-00904".into()),
                "Identificador inválido",
            ))
        });
        assert_eq!(result.unwrap_err().code.as_deref(), Some("ORA-00904"));
    }

    #[test]
    fn roles_tienen_alternativa_sin_privilegios() {
        let (sql, _) = objects_query(Scope::All, ObjectType::Role, None);
        assert!(sql.contains("FROM dba_roles"));
        let (fb, _) = fallback_query(Scope::All, ObjectType::Role, None).unwrap();
        assert!(fb.contains("FROM user_role_privs"));
        assert!(fallback_query(Scope::All, ObjectType::Profile, None).is_none());
        assert!(fallback_query(Scope::All, ObjectType::Table, None).is_none());
    }

    #[test]
    fn merge_de_decenas_de_miles_de_filas_es_rapido() {
        let rows: Vec<RawRow> = (0..40_000)
            .map(|i| raw("PUBLIC", &format!("SYN_{i:06}"), "SYNONYM", "VALID"))
            .collect();
        let t0 = std::time::Instant::now();
        let out = merge_status(ObjectType::Synonym, rows);
        assert_eq!(out.len(), 40_000);
        assert!(
            t0.elapsed() < std::time::Duration::from_millis(300),
            "{:?}",
            t0.elapsed()
        );
    }

    #[test]
    fn mismo_nombre_distinto_owner_no_se_mezcla() {
        let out = merge_status(
            ObjectType::Package,
            vec![
                raw("HR", "P", "PACKAGE", "VALID"),
                raw("SCOTT", "P", "PACKAGE", "VALID"),
            ],
        );
        assert_eq!(out.len(), 2);
    }
}
