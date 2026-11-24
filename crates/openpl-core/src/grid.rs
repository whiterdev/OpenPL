//! Edición en grilla: aplica cambios por ROWID sobre una tabla, todo o nada.

use crate::catalog::{editor_object, ObjectType};
use crate::sql::{row_cells, NumberText};
use openpl_oracle::{DbConn, DbError};
use oracle::sql_type::{Timestamp, ToSql};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Values = BTreeMap<String, Option<String>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EditColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    /// `false` para tipos que v1 muestra pero no edita (BLOB, LONG, RAW, objetos).
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditTarget {
    pub owner: String,
    pub name: String,
    pub columns: Vec<EditColumn>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum RowChange {
    Update {
        rowid: String,
        original: Values,
        values: Values,
    },
    Delete {
        rowid: String,
        original: Values,
    },
    Insert {
        values: Values,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ConflictReason {
    /// Otra sesión tiene la fila bloqueada (ORA-00054).
    Locked,
    /// Algún valor leído cambió desde la consulta.
    Changed,
    /// La fila ya no existe.
    Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Conflict {
    pub index: usize,
    pub reason: ConflictReason,
    pub current: Option<Values>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum ApplyResult {
    Applied {
        updated: u64,
        deleted: u64,
        /// ROWID de cada inserción, en el orden recibido.
        inserted: Vec<String>,
        transaction: bool,
    },
    Conflicts {
        conflicts: Vec<Conflict>,
    },
}

const SAVEPOINT: &str = "OPENPL_GRID";

pub fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Tipos que v1 edita. El resto se muestra en solo lectura.
pub fn is_editable(data_type: &str) -> bool {
    let base = data_type.split('(').next().unwrap_or("").trim();
    matches!(
        base,
        "VARCHAR2"
            | "NVARCHAR2"
            | "CHAR"
            | "NCHAR"
            | "CLOB"
            | "NCLOB"
            | "NUMBER"
            | "FLOAT"
            | "BINARY_FLOAT"
            | "BINARY_DOUBLE"
            | "DATE"
    ) || base.starts_with("TIMESTAMP")
}

fn is_number(data_type: &str) -> bool {
    matches!(
        data_type,
        "NUMBER" | "FLOAT" | "BINARY_FLOAT" | "BINARY_DOUBLE"
    )
}

fn is_date(data_type: &str) -> bool {
    data_type == "DATE" || data_type.starts_with("TIMESTAMP")
}

/// Columnas de `values` que difieren de `original` (comparación de texto, NULL incluido).
pub fn changed_columns<'a>(original: &'a Values, current: &Values) -> Vec<&'a str> {
    original
        .iter()
        .filter(|(name, value)| current.get(*name) != Some(*value))
        .map(|(name, _)| name.as_str())
        .collect()
}

pub fn lock_sql(target: &EditTarget, columns: &[&str]) -> String {
    let list = if columns.is_empty() {
        "1".to_string()
    } else {
        columns
            .iter()
            .map(|c| quote(c))
            .collect::<Vec<_>>()
            .join(", ")
    };
    format!(
        "SELECT {list} FROM {}.{} WHERE ROWID = CHARTOROWID(:rid) FOR UPDATE NOWAIT",
        quote(&target.owner),
        quote(&target.name)
    )
}

pub fn update_sql(target: &EditTarget, columns: &[&str]) -> String {
    let set = columns
        .iter()
        .enumerate()
        .map(|(i, c)| format!("{} = :v{i}", quote(c)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "UPDATE {}.{} SET {set} WHERE ROWID = CHARTOROWID(:rid)",
        quote(&target.owner),
        quote(&target.name)
    )
}

pub fn delete_sql(target: &EditTarget) -> String {
    format!(
        "DELETE FROM {}.{} WHERE ROWID = CHARTOROWID(:rid)",
        quote(&target.owner),
        quote(&target.name)
    )
}

pub fn insert_sql(target: &EditTarget, columns: &[&str]) -> String {
    let table = format!("{}.{}", quote(&target.owner), quote(&target.name));
    if columns.is_empty() {
        return format!(
            "INSERT INTO {table} VALUES DEFAULT RETURNING ROWIDTOCHAR(ROWID) INTO :rid"
        );
    }
    let names = columns
        .iter()
        .map(|c| quote(c))
        .collect::<Vec<_>>()
        .join(", ");
    let binds = (0..columns.len())
        .map(|i| format!(":v{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("INSERT INTO {table} ({names}) VALUES ({binds}) RETURNING ROWIDTOCHAR(ROWID) INTO :rid")
}

/// Valor de la grilla convertido al tipo de la columna.
fn typed(column: &EditColumn, value: &Option<String>) -> Result<Box<dyn ToSql>, DbError> {
    let text = value.as_deref().filter(|v| !v.is_empty());
    let base = column.data_type.split('(').next().unwrap_or("").trim();
    let invalid = |what: &str| {
        DbError::from_code(
            None,
            &format!("{}: «{}» no es {what}", column.name, text.unwrap_or("")),
        )
    };
    if is_number(base) {
        return Ok(match text {
            None => Box::new(None::<f64>),
            Some(t) => {
                let normalized = t.trim().replace(',', ".");
                if normalized.parse::<f64>().is_err() {
                    return Err(invalid("un número"));
                }
                Box::new(NumberText(normalized))
            }
        });
    }
    if is_date(base) {
        return Ok(match text {
            None => Box::new(None::<Timestamp>),
            Some(t) => {
                let t = t.trim();
                let full = if t.len() == 10 {
                    format!("{t} 00:00:00")
                } else {
                    t.to_string()
                };
                Box::new(
                    full.parse::<Timestamp>()
                        .map_err(|_| invalid("una fecha"))?,
                )
            }
        });
    }
    Ok(Box::new(text.map(str::to_string)))
}

/// La tabla que edita la grilla, resolviendo sinónimos. `None` si no es una tabla.
pub fn edit_target(
    conn: &DbConn,
    owner: Option<&str>,
    name: &str,
) -> Result<Option<EditTarget>, DbError> {
    let Some(object) = editor_object(conn, owner, name, None)? else {
        return Ok(None);
    };
    if object.object_type != ObjectType::Table {
        return Ok(None);
    }
    let columns = conn
        .raw()
        .query_as::<(String, String, String)>(
            "SELECT column_name, data_type, nullable FROM all_tab_columns
             WHERE owner = :1 AND table_name = :2 ORDER BY column_id",
            &[&object.owner, &object.name],
        )?
        .map(|row| {
            let (name, data_type, nullable) = row?;
            Ok(EditColumn {
                editable: is_editable(&data_type),
                name,
                data_type,
                nullable: nullable == "Y",
            })
        })
        .collect::<Result<Vec<_>, DbError>>()?;
    Ok(Some(EditTarget {
        owner: object.owner,
        name: object.name,
        columns,
    }))
}

fn column<'a>(target: &'a EditTarget, name: &str) -> Result<&'a EditColumn, DbError> {
    target
        .columns
        .iter()
        .find(|c| c.name == name && c.editable)
        .ok_or_else(|| DbError::from_code(None, &format!("{name}: columna no editable")))
}

/// Bloquea la fila y compara lo leído en la grilla con lo que hay ahora.
fn check(
    conn: &DbConn,
    target: &EditTarget,
    index: usize,
    rowid: &str,
    original: &Values,
) -> Result<Option<Conflict>, DbError> {
    let names: Vec<&str> = original.keys().map(String::as_str).collect();
    let sql = lock_sql(target, &names);
    let mut rows = match conn.raw().query_named(&sql, &[("rid", &rowid)]) {
        Ok(rows) => rows,
        Err(e) => {
            let e = DbError::from(e);
            if e.code.as_deref() == Some("ORA-00054") {
                return Ok(Some(Conflict {
                    index,
                    reason: ConflictReason::Locked,
                    current: None,
                }));
            }
            return Err(e);
        }
    };
    let Some(row) = rows.next() else {
        return Ok(Some(Conflict {
            index,
            reason: ConflictReason::Missing,
            current: None,
        }));
    };
    let cells = row_cells(&row?)?;
    let current: Values = names
        .iter()
        .map(|n| n.to_string())
        .zip(cells.into_iter().chain(std::iter::repeat(None)))
        .collect();
    if changed_columns(original, &current).is_empty() {
        Ok(None)
    } else {
        Ok(Some(Conflict {
            index,
            reason: ConflictReason::Changed,
            current: Some(current),
        }))
    }
}

fn apply_all(
    conn: &DbConn,
    target: &EditTarget,
    changes: &[RowChange],
) -> Result<ApplyResult, DbError> {
    let mut conflicts = Vec::new();
    for (index, change) in changes.iter().enumerate() {
        let (rowid, original) = match change {
            RowChange::Update {
                rowid, original, ..
            }
            | RowChange::Delete { rowid, original } => (rowid, original),
            RowChange::Insert { .. } => continue,
        };
        if let Some(conflict) = check(conn, target, index, rowid, original)? {
            conflicts.push(conflict);
        }
    }
    if !conflicts.is_empty() {
        return Ok(ApplyResult::Conflicts { conflicts });
    }

    let (mut updated, mut deleted, mut inserted) = (0, 0, Vec::new());
    for change in changes {
        match change {
            RowChange::Update {
                rowid,
                values,
                original,
            } => {
                let columns: Vec<&str> = values
                    .iter()
                    .filter(|(name, value)| original.get(*name) != Some(*value))
                    .map(|(name, _)| name.as_str())
                    .collect();
                if columns.is_empty() {
                    continue;
                }
                let params = columns
                    .iter()
                    .map(|c| typed(column(target, c)?, &values[*c]))
                    .collect::<Result<Vec<_>, _>>()?;
                let names: Vec<String> = (0..columns.len()).map(|i| format!("v{i}")).collect();
                let mut binds: Vec<(&str, &dyn ToSql)> = names
                    .iter()
                    .zip(&params)
                    .map(|(n, p)| (n.as_str(), p.as_ref()))
                    .collect();
                binds.push(("rid", rowid));
                conn.raw()
                    .execute_named(&update_sql(target, &columns), &binds)?;
                updated += 1;
            }
            RowChange::Delete { rowid, .. } => {
                conn.raw()
                    .execute_named(&delete_sql(target), &[("rid", rowid)])?;
                deleted += 1;
            }
            RowChange::Insert { values } => {
                let columns: Vec<&str> = values
                    .iter()
                    .filter(|(_, v)| v.as_deref().is_some_and(|t| !t.is_empty()))
                    .map(|(name, _)| name.as_str())
                    .collect();
                let params = columns
                    .iter()
                    .map(|c| typed(column(target, c)?, &values[*c]))
                    .collect::<Result<Vec<_>, _>>()?;
                let names: Vec<String> = (0..columns.len()).map(|i| format!("v{i}")).collect();
                let out = oracle::sql_type::OracleType::Varchar2(64);
                let mut binds: Vec<(&str, &dyn ToSql)> = names
                    .iter()
                    .zip(&params)
                    .map(|(n, p)| (n.as_str(), p.as_ref()))
                    .collect();
                binds.push(("rid", &out));
                let stmt = conn
                    .raw()
                    .execute_named(&insert_sql(target, &columns), &binds)?;
                let rowids: Vec<String> = stmt.returned_values("rid")?;
                inserted.push(rowids.into_iter().next().unwrap_or_default());
            }
        }
    }
    Ok(ApplyResult::Applied {
        updated,
        deleted,
        inserted,
        transaction: true,
    })
}

/// Aplica los cambios en la transacción de la sesión. Si hay conflictos o un error, no deja nada aplicado.
pub fn apply(
    conn: &DbConn,
    target: &EditTarget,
    changes: &[RowChange],
) -> Result<ApplyResult, DbError> {
    conn.raw().execute(&format!("SAVEPOINT {SAVEPOINT}"), &[])?;
    let undo = || {
        conn.raw()
            .execute(&format!("ROLLBACK TO SAVEPOINT {SAVEPOINT}"), &[])
    };
    match apply_all(conn, target, changes) {
        Ok(ApplyResult::Applied {
            updated,
            deleted,
            inserted,
            ..
        }) => Ok(ApplyResult::Applied {
            updated,
            deleted,
            inserted,
            transaction: crate::sql::in_transaction(conn).unwrap_or(true),
        }),
        Ok(conflicts) => {
            undo()?;
            Ok(conflicts)
        }
        Err(e) => {
            let _ = undo();
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> EditTarget {
        EditTarget {
            owner: "HR".into(),
            name: "Clientes 2026".into(),
            columns: vec![
                EditColumn {
                    name: "ID".into(),
                    data_type: "NUMBER".into(),
                    nullable: false,
                    editable: true,
                },
                EditColumn {
                    name: "FOTO".into(),
                    data_type: "BLOB".into(),
                    nullable: true,
                    editable: false,
                },
            ],
        }
    }

    fn values(pairs: &[(&str, Option<&str>)]) -> Values {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.map(Into::into)))
            .collect()
    }

    #[test]
    fn sentencias_por_rowid_con_nombres_entre_comillas() {
        let t = target();
        assert_eq!(
            update_sql(&t, &["NOMBRE", "ALTA"]),
            "UPDATE \"HR\".\"Clientes 2026\" SET \"NOMBRE\" = :v0, \"ALTA\" = :v1 WHERE ROWID = CHARTOROWID(:rid)"
        );
        assert_eq!(
            delete_sql(&t),
            "DELETE FROM \"HR\".\"Clientes 2026\" WHERE ROWID = CHARTOROWID(:rid)"
        );
        assert!(
            lock_sql(&t, &["ID"]).ends_with("WHERE ROWID = CHARTOROWID(:rid) FOR UPDATE NOWAIT")
        );
        assert_eq!(
            insert_sql(&t, &["ID"]),
            "INSERT INTO \"HR\".\"Clientes 2026\" (\"ID\") VALUES (:v0) RETURNING ROWIDTOCHAR(ROWID) INTO :rid"
        );
        assert!(insert_sql(&t, &[]).contains("VALUES DEFAULT"));
    }

    #[test]
    fn tipos_editables_en_v1() {
        for t in ["VARCHAR2", "CHAR", "NUMBER", "DATE", "TIMESTAMP(6)", "CLOB"] {
            assert!(is_editable(t), "{t}");
        }
        for t in ["BLOB", "LONG", "RAW", "XMLTYPE", "SDO_GEOMETRY"] {
            assert!(!is_editable(t), "{t}");
        }
    }

    #[test]
    fn compara_valores_incluido_null() {
        let original = values(&[("A", Some("1")), ("B", None)]);
        assert!(changed_columns(&original, &values(&[("A", Some("1")), ("B", None)])).is_empty());
        assert_eq!(
            changed_columns(&original, &values(&[("A", Some("1")), ("B", Some("x"))])),
            vec!["B"]
        );
    }

    #[test]
    fn valores_se_validan_con_el_tipo_de_la_columna() {
        let t = target();
        assert!(typed(&t.columns[0], &Some("12,5".into())).is_ok());
        assert!(typed(&t.columns[0], &None).is_ok());
        let e = typed(&t.columns[0], &Some("doce".into())).err().unwrap();
        assert_eq!(e.message, "ID: «doce» no es un número");
        assert!(column(&t, "FOTO").is_err());
    }
}
