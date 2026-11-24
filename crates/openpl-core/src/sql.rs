//! Ejecución de sentencias de la Ventana SQL. Corre siempre en el hilo de su sesión.

use openpl_oracle::{DbConn, DbError};
use oracle::sql_type::{OracleType, Timestamp, ToSql};
use oracle::{ResultSet, Row, StatementType};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::time::Instant;

/// Filas por página cuando la interfaz no indica otra cantidad.
pub const PAGE_SIZE: usize = 200;
/// Tope de líneas de DBMS_OUTPUT leídas por ejecución.
pub const OUTPUT_LIMIT: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum BindKind {
    Text,
    Number,
    Date,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BindValue {
    pub name: String,
    /// `None` o vacío se envía como NULL.
    pub value: Option<String>,
    pub kind: BindKind,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Column {
    pub name: String,
    pub type_name: String,
    pub numeric: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryPage {
    pub rows: Vec<Vec<Option<String>>>,
    pub more: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum ExecResult {
    Query {
        cursor: u64,
        columns: Vec<Column>,
        page: QueryPage,
    },
    Done {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecOutcome {
    pub result: ExecResult,
    pub elapsed_ms: u64,
    pub output: Vec<String>,
    pub transaction: bool,
}

struct OpenCursor {
    id: u64,
    rows: ResultSet<'static, Row>,
}

thread_local! {
    // Cada sesión vive en su propio hilo: este cursor es el de esa sesión.
    static CURSOR: RefCell<Option<OpenCursor>> = const { RefCell::new(None) };
    static NEXT_CURSOR: RefCell<u64> = const { RefCell::new(1) };
}

/// Mensaje corto para sentencias que no devuelven filas.
pub fn done_message(kind: StatementType, rows: u64) -> String {
    let filas = |verbo: &str| {
        if rows == 1 {
            format!("1 fila {verbo}")
        } else {
            format!("{rows} filas {verbo}s")
        }
    };
    match kind {
        StatementType::Insert => filas("insertada"),
        StatementType::Update => filas("actualizada"),
        StatementType::Delete => filas("borrada"),
        StatementType::Merge => filas("combinada"),
        StatementType::Begin | StatementType::Declare | StatementType::Call => {
            "Bloque ejecutado".into()
        }
        StatementType::Commit => "Commit hecho".into(),
        StatementType::Rollback => "Rollback hecho".into(),
        _ => "Sentencia ejecutada".into(),
    }
}

pub fn is_numeric(t: &OracleType) -> bool {
    matches!(
        t,
        OracleType::Number(..)
            | OracleType::Float(..)
            | OracleType::BinaryFloat
            | OracleType::BinaryDouble
            | OracleType::Int64
            | OracleType::UInt64
    )
}

fn binary_label(t: &OracleType) -> Option<&'static str> {
    match t {
        OracleType::BLOB => Some("(BLOB)"),
        OracleType::BFILE => Some("(BFILE)"),
        OracleType::LongRaw => Some("(LONG RAW)"),
        OracleType::Object(_) => Some("(objeto)"),
        OracleType::RefCursor => Some("(cursor)"),
        _ => None,
    }
}

/// Número escrito por el usuario; Oracle lo convierte sin depender de NLS_NUMERIC_CHARACTERS.
struct NumberText(String);

impl ToSql for NumberText {
    fn oratype(&self, _conn: &oracle::Connection) -> oracle::Result<OracleType> {
        Ok(OracleType::Number(0, -127))
    }
    fn to_sql(&self, val: &mut oracle::SqlValue) -> oracle::Result<()> {
        val.set(&self.0.as_str())
    }
}

/// Convierte el valor de la interfaz al tipo pedido. Fecha: `AAAA-MM-DD` con hora opcional.
fn bind_param(b: &BindValue) -> Result<Box<dyn ToSql>, DbError> {
    let value = b.value.as_deref().map(str::trim).filter(|v| !v.is_empty());
    let Some(value) = value else {
        return Ok(match b.kind {
            BindKind::Text => Box::new(None::<String>),
            BindKind::Number => Box::new(None::<f64>),
            BindKind::Date => Box::new(None::<Timestamp>),
        });
    };
    let invalid = |what: &str| {
        DbError::from_code(None, &format!("Valor de :{} no es {what}: {value}", b.name))
    };
    Ok(match b.kind {
        BindKind::Text => Box::new(value.to_string()),
        BindKind::Number => {
            let normalized = value.replace(',', ".");
            if normalized.parse::<f64>().is_err() {
                return Err(invalid("un número"));
            }
            Box::new(NumberText(normalized))
        }
        BindKind::Date => {
            let full = if value.len() == 10 {
                format!("{value} 00:00:00")
            } else {
                value.to_string()
            };
            Box::new(
                full.parse::<Timestamp>()
                    .map_err(|_| invalid("una fecha"))?,
            )
        }
    })
}

fn read_page(rows: &mut ResultSet<'static, Row>, size: usize) -> Result<QueryPage, DbError> {
    let mut out = Vec::new();
    while out.len() < size {
        let Some(row) = rows.next() else {
            return Ok(QueryPage {
                rows: out,
                more: false,
            });
        };
        let row = row?;
        let mut cells = Vec::with_capacity(row.sql_values().len());
        for value in row.sql_values() {
            let t = value.oracle_type()?;
            if value.is_null()? {
                cells.push(None);
            } else if let Some(label) = binary_label(t) {
                cells.push(Some(label.to_string()));
            } else {
                let text = value.get::<String>().unwrap_or_else(|_| format!("({t})"));
                cells.push(Some(text));
            }
        }
        out.push(cells);
    }
    Ok(QueryPage {
        rows: out,
        more: true,
    })
}

pub fn in_transaction(conn: &DbConn) -> Result<bool, DbError> {
    let id: Option<String> = conn.raw().query_row_as(
        "SELECT DBMS_TRANSACTION.LOCAL_TRANSACTION_ID FROM DUAL",
        &[],
    )?;
    Ok(id.is_some())
}

pub fn enable_output(conn: &DbConn) -> Result<(), DbError> {
    conn.raw()
        .execute("BEGIN DBMS_OUTPUT.ENABLE(NULL); END;", &[])?;
    Ok(())
}

pub fn read_output(conn: &DbConn) -> Result<Vec<String>, DbError> {
    let mut stmt = conn
        .raw()
        .statement("BEGIN DBMS_OUTPUT.GET_LINE(:1, :2); END;")
        .build()?;
    let mut lines = Vec::new();
    while lines.len() < OUTPUT_LIMIT {
        stmt.execute(&[&OracleType::Varchar2(32767), &OracleType::Number(0, 0)])?;
        let status: i32 = stmt.bind_value(2)?;
        if status != 0 {
            break;
        }
        let line: Option<String> = stmt.bind_value(1)?;
        lines.push(line.unwrap_or_default());
    }
    Ok(lines)
}

/// Ejecuta una sentencia. Una consulta deja su cursor abierto para `fetch`.
pub fn execute(
    conn: &DbConn,
    sql: &str,
    binds: &[BindValue],
    page_size: usize,
) -> Result<ExecOutcome, DbError> {
    CURSOR.with(|c| c.borrow_mut().take());
    let params = binds
        .iter()
        .map(bind_param)
        .collect::<Result<Vec<_>, _>>()?;
    let named: Vec<(&str, &dyn ToSql)> = binds
        .iter()
        .zip(&params)
        .map(|(b, p)| (b.name.as_str(), p.as_ref()))
        .collect();
    let started = Instant::now();
    let mut stmt = conn
        .raw()
        .statement(sql)
        .fetch_array_size(page_size as u32)
        .build()?;
    let result = if stmt.is_query() {
        let mut rows = stmt.into_result_set_named::<Row>(&named)?;
        let columns = rows
            .column_info()
            .iter()
            .map(|c| Column {
                name: c.name().to_string(),
                type_name: c.oracle_type().to_string(),
                numeric: is_numeric(c.oracle_type()),
            })
            .collect();
        let page = read_page(&mut rows, page_size)?;
        let id = NEXT_CURSOR.with(|n| {
            let mut n = n.borrow_mut();
            *n += 1;
            *n
        });
        if page.more {
            CURSOR.with(|c| *c.borrow_mut() = Some(OpenCursor { id, rows }));
        }
        ExecResult::Query {
            cursor: id,
            columns,
            page,
        }
    } else {
        stmt.execute_named(&named)?;
        let kind = stmt.statement_type();
        let count = stmt.row_count().unwrap_or(0);
        ExecResult::Done {
            message: done_message(kind, count),
        }
    };
    let elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(ExecOutcome {
        result,
        elapsed_ms,
        output: read_output(conn).unwrap_or_default(),
        transaction: in_transaction(conn).unwrap_or(false),
    })
}

/// Siguiente página del cursor abierto. Un cursor ya cerrado devuelve una página vacía.
pub fn fetch(cursor: u64, size: usize) -> Result<QueryPage, DbError> {
    CURSOR.with(|c| {
        let mut slot = c.borrow_mut();
        let Some(open) = slot.as_mut().filter(|o| o.id == cursor) else {
            return Ok(QueryPage {
                rows: Vec::new(),
                more: false,
            });
        };
        let page = read_page(&mut open.rows, size)?;
        if !page.more {
            *slot = None;
        }
        Ok(page)
    })
}

pub fn commit(conn: &DbConn) -> Result<bool, DbError> {
    conn.raw().commit()?;
    in_transaction(conn)
}

pub fn rollback(conn: &DbConn) -> Result<bool, DbError> {
    CURSOR.with(|c| c.borrow_mut().take());
    conn.raw().rollback()?;
    in_transaction(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bind(kind: BindKind, value: Option<&str>) -> BindValue {
        BindValue {
            name: "x".into(),
            value: value.map(Into::into),
            kind,
        }
    }

    #[test]
    fn mensajes_de_filas_afectadas() {
        assert_eq!(done_message(StatementType::Update, 1), "1 fila actualizada");
        assert_eq!(done_message(StatementType::Delete, 3), "3 filas borradas");
        assert_eq!(done_message(StatementType::Insert, 0), "0 filas insertadas");
        assert_eq!(done_message(StatementType::Declare, 0), "Bloque ejecutado");
        assert_eq!(
            done_message(StatementType::Create, 0),
            "Sentencia ejecutada"
        );
    }

    #[test]
    fn columnas_numericas_se_alinean_a_la_derecha() {
        assert!(is_numeric(&OracleType::Number(10, 2)));
        assert!(is_numeric(&OracleType::BinaryDouble));
        assert!(!is_numeric(&OracleType::Varchar2(30)));
        assert!(!is_numeric(&OracleType::Date));
    }

    #[test]
    fn binds_validan_numeros_y_fechas() {
        assert!(bind_param(&bind(BindKind::Number, Some("12,5"))).is_ok());
        assert!(bind_param(&bind(BindKind::Date, Some("2026-11-24"))).is_ok());
        assert!(bind_param(&bind(BindKind::Date, Some("2026-11-24 10:30:00"))).is_ok());
        assert!(bind_param(&bind(BindKind::Text, None)).is_ok());
        let e = bind_param(&bind(BindKind::Number, Some("doce")))
            .err()
            .unwrap();
        assert_eq!(e.message, "Valor de :x no es un número: doce");
        assert!(bind_param(&bind(BindKind::Date, Some("24/11/2026"))).is_err());
    }

    #[test]
    fn fetch_sin_cursor_abierto_devuelve_pagina_vacia() {
        let page = fetch(99, 10).unwrap();
        assert!(page.rows.is_empty() && !page.more);
    }
}
