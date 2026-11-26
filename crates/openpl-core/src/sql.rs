//! Ejecución de sentencias de la Ventana SQL. Corre siempre en el hilo de su sesión.

use crate::value_fmt::{format_timestamp, parse_timestamp};
use openpl_oracle::{DbConn, DbError, ErrorKind};
use oracle::sql_type::{Clob, Nclob, OracleType, RefCursor, Timestamp, ToSql};
use oracle::{ColumnInfo, ResultSet, Row, Statement, StatementType};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::io::Read;
use std::iter::Peekable;
use std::time::Instant;

/// Filas por página cuando la interfaz no indica otra cantidad.
pub const PAGE_SIZE: usize = 50;
/// Tope de líneas de DBMS_OUTPUT leídas por ejecución.
pub const OUTPUT_LIMIT: usize = 10_000;
const LOB_CHAR_LIMIT: usize = 1_000_000;

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
    pub lob: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryPage {
    pub rows: Vec<Vec<Option<String>>>,
    pub more: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExplainPlan {
    pub columns: Vec<Column>,
    pub page: QueryPage,
}

/// Se ejecuta únicamente en la sesión descartable del plan.
pub fn explain(conn: &DbConn, sql: &str, id: &str) -> Result<ExplainPlan, DbError> {
    let kind = conn.raw().statement(sql).build()?.statement_type();
    if !matches!(
        kind,
        StatementType::Select
            | StatementType::Insert
            | StatementType::Update
            | StatementType::Delete
            | StatementType::Merge
    ) || id.len() != 30
        || !id.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(DbError::from_code(
            None,
            "La sentencia no admite plan de ejecución.",
        ));
    }
    conn.raw().execute(
        &format!("EXPLAIN PLAN SET STATEMENT_ID = '{id}' FOR {sql}"),
        &[],
    )?;
    let rows = conn.raw().query(
        "SELECT id, parent_id, depth, operation, options, object_owner, object_name, cost, cardinality
         FROM plan_table WHERE statement_id = CAST(:1 AS VARCHAR2(30)) ORDER BY id",
        &[&id],
    )?;
    let columns = result_columns(rows.column_info());
    let page = read_page(&mut rows.peekable(), 300, |row| row_cells(&row))?;
    Ok(ExplainPlan { columns, page })
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
    Failed {
        error: DbError,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecOutcome {
    pub result: ExecResult,
    pub elapsed_ms: u64,
    pub output: Vec<String>,
    pub transaction: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub test_outputs: Vec<TestOutput>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum TestOutputKind {
    Text,
    Number,
    Date,
    Timestamp,
    Clob,
    Cursor,
}

impl TestOutputKind {
    fn oracle_type(self) -> OracleType {
        match self {
            Self::Text => OracleType::Varchar2(32767),
            Self::Number => OracleType::Number(0, -127),
            Self::Date => OracleType::Date,
            Self::Timestamp => OracleType::Timestamp(9),
            Self::Clob => OracleType::CLOB,
            Self::Cursor => OracleType::RefCursor,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TestOutputBind {
    name: String,
    kind: TestOutputKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct TestOutput {
    name: String,
    #[serde(flatten)]
    value: TestOutputValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
enum TestOutputValue {
    Scalar {
        value: Option<String>,
    },
    Cursor {
        columns: Vec<Column>,
        page: QueryPage,
    },
    Error {
        message: String,
    },
}

fn result_columns(columns: &[ColumnInfo]) -> Vec<Column> {
    columns
        .iter()
        .map(|c| Column {
            name: c.name().to_string(),
            type_name: c.oracle_type().to_string(),
            numeric: is_numeric(c.oracle_type()),
            lob: matches!(
                c.oracle_type(),
                OracleType::CLOB
                    | OracleType::NCLOB
                    | OracleType::Long
                    | OracleType::BLOB
                    | OracleType::BFILE
                    | OracleType::LongRaw
            ),
        })
        .collect()
}

fn read_test_output(
    stmt: &Statement,
    bind: &TestOutputBind,
    size: usize,
) -> Result<TestOutputValue, DbError> {
    let name = bind.name.as_str();
    match bind.kind {
        TestOutputKind::Text
        | TestOutputKind::Number
        | TestOutputKind::Date
        | TestOutputKind::Timestamp => Ok(TestOutputValue::Scalar {
            value: stmt.bind_value(name)?,
        }),
        TestOutputKind::Clob => {
            let clob: Option<Clob> = stmt.bind_value(name)?;
            let value = if let Some(clob) = clob {
                let mut bytes = Vec::new();
                clob.take(128 * 1024 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|err| DbError::from_code(None, &err.to_string()))?;
                let truncated = bytes.len() > 128 * 1024;
                bytes.truncate(128 * 1024);
                let mut value = String::from_utf8_lossy(&bytes).into_owned();
                if truncated {
                    value.push('…');
                }
                Some(value)
            } else {
                None
            };
            Ok(TestOutputValue::Scalar { value })
        }
        TestOutputKind::Cursor => {
            let cursor: Option<RefCursor> = stmt.bind_value(name)?;
            let Some(mut cursor) = cursor else {
                return Ok(TestOutputValue::Scalar { value: None });
            };
            let rows = cursor.query()?;
            let columns = result_columns(rows.column_info());
            let page = read_page(&mut rows.peekable(), size, |row| row_cells(&row))?;
            Ok(TestOutputValue::Cursor { columns, page })
        }
    }
}

struct OpenCursor {
    id: u64,
    rows: Peekable<ResultSet<'static, Row>>,
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
pub(crate) struct NumberText(pub(crate) String);

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
        BindKind::Date => Box::new(parse_timestamp(value).map_err(|_| invalid("una fecha"))?),
    })
}

fn cap_text(text: &str, cap: usize) -> (String, bool) {
    match text.char_indices().nth(cap) {
        Some((end, _)) => (text[..end].to_owned(), true),
        None => (text.to_owned(), false),
    }
}

fn read_capped_text(mut reader: impl Read, cap: usize) -> Result<String, DbError> {
    let mut bytes = Vec::new();
    let mut chunk = [0; 8192];
    while bytes.len() <= cap.saturating_mul(4) {
        let count = reader
            .read(&mut chunk)
            .map_err(|err| DbError::from_code(None, &err.to_string()))?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    Ok(cap_text(&String::from_utf8_lossy(&bytes), cap).0)
}

/// Valores de una fila como texto, con el mismo formato en la grilla y al comparar al aplicar.
pub(crate) fn row_cells(row: &Row) -> Result<Vec<Option<String>>, DbError> {
    let mut cells = Vec::with_capacity(row.sql_values().len());
    for value in row.sql_values() {
        let t = value.oracle_type()?;
        if value.is_null()? {
            cells.push(None);
        } else if let Some(label) = binary_label(t) {
            cells.push(Some(label.to_string()));
        } else if matches!(t, OracleType::CLOB | OracleType::NCLOB | OracleType::Long) {
            let text = match t {
                OracleType::CLOB => value
                    .get::<Clob>()
                    .ok()
                    .map(|lob| read_capped_text(lob, LOB_CHAR_LIMIT)),
                OracleType::NCLOB => value
                    .get::<Nclob>()
                    .ok()
                    .map(|lob| read_capped_text(lob, LOB_CHAR_LIMIT)),
                _ => None,
            };
            let text = match text {
                Some(text) => text?,
                None => cap_text(&value.get::<String>()?, LOB_CHAR_LIMIT).0,
            };
            cells.push(Some(text));
        } else if matches!(
            t,
            OracleType::Date
                | OracleType::Timestamp(_)
                | OracleType::TimestampTZ(_)
                | OracleType::TimestampLTZ(_)
        ) {
            cells.push(Some(format_timestamp(&value.get::<Timestamp>()?, t)));
        } else {
            let text = value.get::<String>().unwrap_or_else(|_| format!("({t})"));
            cells.push(Some(text));
        }
    }
    Ok(cells)
}

fn read_page<T, E>(
    rows: &mut Peekable<impl Iterator<Item = Result<T, E>>>,
    size: usize,
    cells: impl Fn(T) -> Result<Vec<Option<String>>, DbError>,
) -> Result<QueryPage, DbError>
where
    DbError: From<E>,
{
    let page = rows
        .by_ref()
        .take(size)
        .map(|row| cells(row?))
        .collect::<Result<_, _>>()?;
    Ok(QueryPage {
        rows: page,
        more: rows.peek().is_some(),
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
    execute_with_outputs(conn, sql, binds, page_size, &[])
}

pub fn execute_with_outputs(
    conn: &DbConn,
    sql: &str,
    binds: &[BindValue],
    page_size: usize,
    outputs: &[TestOutputBind],
) -> Result<ExecOutcome, DbError> {
    CURSOR.with(|c| c.borrow_mut().take());
    let params = binds
        .iter()
        .map(bind_param)
        .collect::<Result<Vec<_>, _>>()?;
    let mut named: Vec<(&str, &dyn ToSql)> = binds
        .iter()
        .zip(&params)
        .map(|(b, p)| (b.name.as_str(), p.as_ref()))
        .collect();
    let output_types: Vec<_> = outputs.iter().map(|bind| bind.kind.oracle_type()).collect();
    named.extend(
        outputs
            .iter()
            .zip(&output_types)
            .map(|(b, t)| (b.name.as_str(), t as &dyn ToSql)),
    );
    let started = Instant::now();
    let mut builder = conn.raw().statement(sql);
    builder.fetch_array_size(page_size as u32).lob_locator();
    let mut stmt = builder.build()?;
    let mut test_outputs = Vec::new();
    let result = if stmt.is_query() {
        let rows = stmt.into_result_set_named::<Row>(&named)?;
        let columns = result_columns(rows.column_info());
        let mut rows = rows.peekable();
        let page = read_page(&mut rows, page_size, |row| row_cells(&row))?;
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
        if let Err(error) = stmt.execute_named(&named) {
            let error = DbError::from(error);
            if error.kind == ErrorKind::ConnectionLost {
                return Err(error);
            }
            return Ok(failed_outcome(
                error,
                started.elapsed().as_millis() as u64,
                read_output(conn).unwrap_or_default(),
                in_transaction(conn).unwrap_or(false),
            ));
        }
        test_outputs = outputs
            .iter()
            .map(|bind| TestOutput {
                name: bind.name.clone(),
                value: read_test_output(&stmt, bind, page_size).unwrap_or_else(|err| {
                    TestOutputValue::Error {
                        message: err.message,
                    }
                }),
            })
            .collect();
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
        test_outputs,
    })
}

fn failed_outcome(
    error: DbError,
    elapsed_ms: u64,
    output: Vec<String>,
    transaction: bool,
) -> ExecOutcome {
    ExecOutcome {
        result: ExecResult::Failed { error },
        elapsed_ms,
        output,
        transaction,
        test_outputs: Vec::new(),
    }
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
        let page = read_page(&mut open.rows, size, |row| row_cells(&row));
        if !matches!(&page, Ok(page) if page.more) {
            *slot = None;
        }
        page
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

    #[test]
    fn tope_lob_cuenta_caracteres_y_respeta_utf8() {
        assert_eq!(cap_text("A😀ñB", 3), ("A😀ñ".into(), true));
        assert_eq!(cap_text("A😀ñ", 3), ("A😀ñ".into(), false));
        assert_eq!(cap_text("ñ", 0), (String::new(), true));
        assert_eq!(read_capped_text("A😀ñB".as_bytes(), 3).unwrap(), "A😀ñ");
    }

    #[test]
    fn ejecucion_fallida_conserva_salida_y_transaccion() {
        let error = DbError::from_code(Some("ORA-20000".into()), "Error de prueba");
        let outcome = failed_outcome(error, 15, vec!["Antes del error".into()], true);
        let ExecResult::Failed { error } = outcome.result else {
            panic!("se esperaba un fallo de ejecución");
        };
        assert_eq!(error.code.as_deref(), Some("ORA-20000"));
        assert_eq!(outcome.elapsed_ms, 15);
        assert_eq!(outcome.output, ["Antes del error"]);
        assert!(outcome.transaction);
        assert!(outcome.test_outputs.is_empty());
    }

    #[test]
    fn tipos_de_salida_tienen_buffers_explicitos() {
        assert_eq!(
            TestOutputKind::Text.oracle_type(),
            OracleType::Varchar2(32767)
        );
        assert_eq!(TestOutputKind::Clob.oracle_type(), OracleType::CLOB);
        assert_eq!(TestOutputKind::Cursor.oracle_type(), OracleType::RefCursor);
        assert_eq!(
            TestOutputKind::Number.oracle_type(),
            OracleType::Number(0, -127)
        );
        assert_eq!(TestOutputKind::Date.oracle_type(), OracleType::Date);
        assert_eq!(
            TestOutputKind::Timestamp.oracle_type(),
            OracleType::Timestamp(9)
        );
    }

    #[test]
    fn vista_inicial_de_50_y_continuacion_sin_omitir_filas() {
        let mut source = (1..=51)
            .map(|n| Ok::<_, DbError>(vec![Some(n.to_string())]))
            .peekable();
        assert_eq!(PAGE_SIZE, 50);
        let first = read_page(&mut source, PAGE_SIZE, Ok).unwrap();
        assert_eq!(first.rows.len(), 50);
        assert!(first.more);
        let rest = read_page(&mut source, PAGE_SIZE, Ok).unwrap();
        assert_eq!(rest.rows, vec![vec![Some("51".into())]]);
        assert!(!rest.more);

        let mut exact = (1..=50).map(|_| Ok::<_, DbError>(vec![None])).peekable();
        assert!(!read_page(&mut exact, PAGE_SIZE, Ok).unwrap().more);
    }

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
