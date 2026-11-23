//! Lectura de fuentes y diagnósticos del diccionario Oracle.

use crate::catalog::ObjectType;
use openpl_oracle::{DbConn, DbError};
use serde::Serialize;

pub fn program_kinds(kind: ObjectType) -> &'static [&'static str] {
    match kind {
        ObjectType::Package => &["PACKAGE", "PACKAGE BODY"],
        ObjectType::Type => &["TYPE", "TYPE BODY"],
        ObjectType::Procedure => &["PROCEDURE"],
        ObjectType::Function => &["FUNCTION"],
        ObjectType::Trigger => &["TRIGGER"],
        _ => &[],
    }
}

/// Añade el prefijo en la primera línea para mantener las coordenadas de ALL_ERRORS.
pub fn source_text<'a>(lines: impl IntoIterator<Item = &'a str>) -> String {
    let mut source = String::from("CREATE OR REPLACE ");
    for line in lines {
        source.push_str(line.trim_end_matches(['\r', '\n']));
        source.push('\n');
    }
    source
}

#[derive(Serialize)]
pub struct ProgramDiagnostic {
    line: u32,
    column: u32,
    text: String,
    warning: bool,
}

#[derive(Serialize)]
pub struct ProgramPart {
    kind: &'static str,
    source: String,
    diagnostics: Vec<ProgramDiagnostic>,
}

pub fn load_program(
    conn: &DbConn,
    kind: ObjectType,
    owner: &str,
    name: &str,
) -> Result<Vec<ProgramPart>, DbError> {
    let db = conn.raw();
    let mut parts = Vec::new();
    for part in program_kinds(kind) {
        let lines = db
            .query_as::<Option<String>>(
                "SELECT text FROM all_source WHERE owner = :1 AND name = :2 AND type = :3 ORDER BY line",
                &[&owner, &name, part],
            )?
            .collect::<Result<Vec<_>, _>>()?;
        if lines.is_empty() {
            continue;
        }
        let source = source_text(lines.iter().map(|line| line.as_deref().unwrap_or_default()));
        let diagnostics = db
            .query_as::<(u32, u32, String, String)>(
                "SELECT line, position, text, attribute FROM all_errors
                 WHERE owner = :1 AND name = :2 AND type = :3 ORDER BY sequence",
                &[&owner, &name, part],
            )?
            .map(|row| {
                let (line, column, text, attribute) = row?;
                Ok::<_, oracle::Error>(ProgramDiagnostic {
                    line,
                    column: if line == 1 && column > 0 {
                        column + 18
                    } else {
                        column
                    },
                    text,
                    warning: attribute == "WARNING",
                })
            })
            .collect::<Result<_, _>>()?;
        parts.push(ProgramPart {
            kind: part,
            source,
            diagnostics,
        });
    }
    if parts.is_empty() {
        return Err(DbError::from_code(None, "Fuente no disponible."));
    }
    Ok(parts)
}
