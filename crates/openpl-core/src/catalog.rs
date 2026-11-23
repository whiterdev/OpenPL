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
    Table,
    View,
    Sequence,
    Synonym,
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
    pub const ALL: [ObjectType; 9] = [
        ObjectType::Package,
        ObjectType::Procedure,
        ObjectType::Function,
        ObjectType::Trigger,
        ObjectType::Type,
        ObjectType::Table,
        ObjectType::View,
        ObjectType::Sequence,
        ObjectType::Synonym,
    ];

    pub fn oracle_types(self) -> &'static [&'static str] {
        match self {
            ObjectType::Package => &["PACKAGE", "PACKAGE BODY"],
            ObjectType::Procedure => &["PROCEDURE"],
            ObjectType::Function => &["FUNCTION"],
            ObjectType::Trigger => &["TRIGGER"],
            ObjectType::Type => &["TYPE", "TYPE BODY"],
            ObjectType::Table => &["TABLE"],
            ObjectType::View => &["VIEW"],
            ObjectType::Sequence => &["SEQUENCE"],
            ObjectType::Synonym => &["SYNONYM"],
        }
    }
}

/// SQL y binds nombrados para listar objetos de un tipo. Compatible con Oracle 12.1.
pub fn objects_query(scope: Scope, t: ObjectType, filter: Option<&str>) -> (String, Vec<(String, String)>) {
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
    if scope == Scope::Mine {
        sql.push_str(" AND owner = USER");
    }
    if let Some(f) = filter.map(str::trim).filter(|f| !f.is_empty()) {
        let escaped: String = f
            .to_uppercase()
            .chars()
            .flat_map(|c| match c {
                '\\' | '%' | '_' => vec!['\\', c],
                _ => vec![c],
            })
            .collect();
        sql.push_str(" AND UPPER(object_name) LIKE :f ESCAPE '\\'");
        binds.push(("f".to_string(), format!("%{escaped}%")));
    }
    sql.push_str(" AND object_name NOT LIKE 'BIN$%' ORDER BY owner, object_name");
    (sql, binds)
}

/// Agrupa spec/body (o type/type body) en un solo objeto; inválido si cualquiera lo es.
pub fn merge_status(t: ObjectType, rows: Vec<RawRow>) -> Vec<ObjectInfo> {
    let mut out: Vec<ObjectInfo> = Vec::new();
    for r in rows {
        let status = if r.status == "VALID" { ObjectStatus::Valid } else { ObjectStatus::Invalid };
        match out.iter_mut().find(|o| o.owner == r.owner && o.name == r.name) {
            Some(o) => {
                if status == ObjectStatus::Invalid {
                    o.status = ObjectStatus::Invalid;
                }
                if r.last_ddl_time > o.last_ddl_time {
                    o.last_ddl_time = r.last_ddl_time;
                }
            }
            None => out.push(ObjectInfo {
                owner: r.owner,
                name: r.name,
                object_type: t,
                status,
                last_ddl_time: r.last_ddl_time,
            }),
        }
    }
    out
}

/// Lista objetos de un tipo desde la base.
pub fn list_objects(
    conn: &DbConn,
    scope: Scope,
    t: ObjectType,
    filter: Option<&str>,
) -> Result<Vec<ObjectInfo>, DbError> {
    let (sql, binds) = objects_query(scope, t, filter);
    let params: Vec<(&str, &dyn oracle::sql_type::ToSql)> =
        binds.iter().map(|(k, v)| (k.as_str(), v as &dyn oracle::sql_type::ToSql)).collect();
    let rows = conn.raw().query_named(&sql, &params)?;
    let mut raw = Vec::new();
    for row in rows {
        let row = row?;
        raw.push(RawRow {
            owner: row.get(0)?,
            name: row.get(1)?,
            oracle_type: row.get(2)?,
            status: row.get(3)?,
            last_ddl_time: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        });
    }
    Ok(merge_status(t, raw))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(b.iter().map(|x| x.1.as_str()).collect::<Vec<_>>(), ["PACKAGE", "PACKAGE BODY"]);
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
        assert!(sql.contains("object_name NOT LIKE 'BIN$%'") && sql.contains("ORDER BY owner, object_name"));
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
        let out = merge_status(ObjectType::Table, vec![raw("HR", "mi_tabla", "TABLE", "VALID")]);
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
    fn mismo_nombre_distinto_owner_no_se_mezcla() {
        let out = merge_status(
            ObjectType::Package,
            vec![raw("HR", "P", "PACKAGE", "VALID"), raw("SCOTT", "P", "PACKAGE", "VALID")],
        );
        assert_eq!(out.len(), 2);
    }
}
