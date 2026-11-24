//! Firmas de rutinas públicas en el diccionario de Oracle.

use openpl_oracle::{DbConn, DbError};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ArgumentRow {
    pub sequence: u32,
    pub position: u32,
    pub depth: u32,
    pub name: Option<String>,
    pub data_type: String,
    pub direction: Option<String>,
    pub defaulted: bool,
    pub type_owner: Option<String>,
    pub type_name: Option<String>,
    pub type_subname: Option<String>,
}

pub struct RoutineRow {
    pub subprogram_id: u32,
    pub overload: Option<String>,
    pub argument: Option<ArgumentRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Argument {
    pub declaration: ArgumentRow,
    pub fields: Vec<ArgumentRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Overload {
    pub subprogram_id: u32,
    pub overload: Option<String>,
    pub parameters: Vec<Argument>,
    pub returns: Option<Argument>,
}

pub fn group_overloads(rows: impl IntoIterator<Item = RoutineRow>) -> Vec<Overload> {
    let mut groups: BTreeMap<u32, (Option<String>, Vec<ArgumentRow>)> = BTreeMap::new();
    for row in rows {
        let (_, arguments) = groups
            .entry(row.subprogram_id)
            .or_insert_with(|| (row.overload, Vec::new()));
        if let Some(argument) = row.argument {
            arguments.push(argument);
        }
    }
    groups
        .into_iter()
        .map(|(subprogram_id, (overload, mut rows))| {
            rows.sort_by_key(|row| row.sequence);
            let mut arguments: Vec<Argument> = Vec::new();
            for row in rows {
                if row.depth == 0 {
                    arguments.push(Argument {
                        declaration: row,
                        fields: Vec::new(),
                    });
                } else if let Some(argument) = arguments.last_mut() {
                    argument.fields.push(row);
                }
            }
            arguments.sort_by_key(|argument| argument.declaration.position);
            let mut arguments = arguments.into_iter().peekable();
            let returns = if arguments
                .peek()
                .is_some_and(|item| item.declaration.position == 0)
            {
                arguments.next()
            } else {
                None
            };
            Overload {
                subprogram_id,
                overload,
                parameters: arguments.collect(),
                returns,
            }
        })
        .collect()
}

const ROUTINE_SQL: &str = "SELECT p.subprogram_id, p.overload,
       a.sequence, a.position, a.data_level, a.argument_name, a.data_type,
       a.in_out, a.defaulted, a.type_owner, a.type_name, a.type_subname
FROM all_procedures p
LEFT JOIN all_arguments a ON a.owner = p.owner AND a.subprogram_id = p.subprogram_id
    AND ((p.procedure_name IS NULL AND a.package_name IS NULL AND a.object_name = p.object_name)
         OR (a.package_name = p.object_name AND a.object_name = p.procedure_name))
WHERE p.owner = CAST(:owner AS VARCHAR2(4000))
  AND p.object_name = CAST(:object_name AS VARCHAR2(4000))
  AND ((CAST(:member AS VARCHAR2(4000)) IS NULL AND p.procedure_name IS NULL
        AND p.object_type IN ('PROCEDURE', 'FUNCTION'))
       OR (p.procedure_name = CAST(:member AS VARCHAR2(4000)) AND p.object_type = 'PACKAGE'))
ORDER BY p.subprogram_id, a.sequence";

pub fn list_overloads(
    conn: &DbConn,
    owner: &str,
    package: Option<&str>,
    name: &str,
) -> Result<Vec<Overload>, DbError> {
    let object_name = package.unwrap_or(name);
    let member = package.map(|_| name);
    let rows = conn.raw().query_named(
        ROUTINE_SQL,
        &[
            ("owner", &owner),
            ("object_name", &object_name),
            ("member", &member),
        ],
    )?;
    let mut signatures = Vec::new();
    for row in rows {
        let row = row?;
        let argument = match row.get::<_, Option<String>>(6)? {
            Some(data_type) => Some(ArgumentRow {
                sequence: row.get(2)?,
                position: row.get(3)?,
                depth: row.get(4)?,
                name: row.get(5)?,
                data_type,
                direction: row.get(7)?,
                defaulted: row.get::<_, Option<String>>(8)?.as_deref() == Some("Y"),
                type_owner: row.get(9)?,
                type_name: row.get(10)?,
                type_subname: row.get(11)?,
            }),
            None => None,
        };
        signatures.push(RoutineRow {
            subprogram_id: row.get(0)?,
            overload: row.get(1)?,
            argument,
        });
    }
    if signatures.is_empty() {
        return Err(DbError::from_code(None, "Rutina pública no disponible."));
    }
    Ok(group_overloads(signatures))
}
