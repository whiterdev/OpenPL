// Decide si una consulta se puede editar en la grilla y le agrega el ROWID oculto.
import { tokenize, type Token } from "./programStructure";

/** Nombre de la columna oculta con el ROWID de cada fila. */
export const ROWID_COLUMN = "OPENPL$ROWID";

export interface EditableQuery {
  table: { owner: string | null; name: string };
  sql: string;
}

const NAME = /^(?:"[^"]+"|[\p{L}][\p{L}\p{N}_$#]*)$/u;
// Cualquiera de estas a nivel superior impide asociar cada fila a una fila de la tabla.
const BLOCKERS = new Set([
  "DISTINCT",
  "UNIQUE",
  "GROUP",
  "UNION",
  "INTERSECT",
  "MINUS",
  "CONNECT",
  "JOIN",
  "PIVOT",
  "UNPIVOT",
  "MODEL",
  "HAVING",
  "START",
]);
const AFTER_TABLE = new Set([
  "WHERE",
  "ORDER",
  "FOR",
  "FETCH",
  "OFFSET",
  "SAMPLE",
  "PARTITION",
  "AS",
]);

const isName = (token: Token | undefined) => !!token && NAME.test(token.text);
const nameOf = (token: Token) =>
  token.text.startsWith('"') ? token.text.slice(1, -1) : token.key;

export function editableQuery(sql: string): EditableQuery | null {
  const tokens = tokenize(sql);
  if (tokens[0]?.key !== "SELECT") return null;
  let depth = 0;
  let from = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const { key } = tokens[i];
    if (key === "(") depth += 1;
    else if (key === ")") depth -= 1;
    else if (depth === 0) {
      if (BLOCKERS.has(key) || key === "@") return null;
      if (key === "FROM" && from < 0) from = i;
    }
  }
  if (from < 1) return null;

  let i = from + 1;
  if (!isName(tokens[i])) return null;
  let table = { owner: null as string | null, name: nameOf(tokens[i]) };
  let end = i;
  if (tokens[i + 1]?.key === "." && isName(tokens[i + 2])) {
    table = { owner: table.name, name: nameOf(tokens[i + 2]) };
    end = i + 2;
  }
  i = end + 1;
  let ref = sql.slice(
    tokens[from + 1].from,
    tokens[end].from + tokens[end].text.length,
  );
  if (isName(tokens[i]) && !AFTER_TABLE.has(tokens[i].key)) {
    ref = tokens[i].text;
    i += 1;
  }
  // Tras la tabla solo puede seguir una cláusula, nunca otra tabla.
  if (tokens[i] && !AFTER_TABLE.has(tokens[i].key) && tokens[i].key !== ";")
    return null;

  const select = tokens[0];
  const list = tokens.slice(1, from);
  const head = sql.slice(0, select.from + select.text.length);
  const rowid = ` ${ref}.ROWID AS "${ROWID_COLUMN}",`;
  if (list.length === 1 && list[0].text === "*") {
    const star = list[0];
    return {
      table,
      sql: `${head}${rowid} ${ref}.*${sql.slice(star.from + 1)}`,
    };
  }
  return {
    table,
    sql: `${head}${rowid}${sql.slice(select.from + select.text.length)}`,
  };
}
