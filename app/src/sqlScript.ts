// Divide un script en sentencias para la Ventana SQL. Las posiciones son del texto original.

export type StatementKind = "sql" | "plsql" | "sqlplus";

export interface ScriptStatement {
  kind: StatementKind;
  /** Texto a ejecutar: sin el `;` final en SQL, con el `END;` en PL/SQL. */
  text: string;
  from: number;
  to: number;
}

const SQLPLUS = new Set([
  "SET", "PROMPT", "SPOOL", "DEFINE", "UNDEFINE", "SHOW", "EXEC", "EXECUTE", "VARIABLE", "VAR", "PRINT",
  "COLUMN", "COL", "CONNECT", "CONN", "DISCONNECT", "WHENEVER", "ACCEPT", "PAUSE", "REM", "REMARK", "CLEAR",
  "BREAK", "COMPUTE", "TTITLE", "BTITLE", "DESC", "DESCRIBE", "HOST", "START", "EXIT", "QUIT", "TIMING", "SPO",
]);
const PLSQL_UNITS = /^(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|LIBRARY|JAVA)\b/;
const CLOSERS: Record<string, string> = { "[": "]", "(": ")", "{": "}", "<": ">" };

/** Si en `i` empieza un literal o comentario, devuelve dónde termina; si no, -1. */
function skipOpaque(source: string, i: number): number {
  const c = source[i];
  const next = source[i + 1];
  if (c === "-" && next === "-") {
    const end = source.indexOf("\n", i);
    return end < 0 ? source.length : end;
  }
  if (c === "/" && next === "*") {
    const end = source.indexOf("*/", i + 2);
    return end < 0 ? source.length : end + 2;
  }
  if ((c === "q" || c === "Q") && next === "'" && i + 2 < source.length && !/[\w$#]/.test(source[i - 1] ?? "")) {
    const open = source[i + 2];
    const close = CLOSERS[open] ?? open;
    const end = source.indexOf(`${close}'`, i + 3);
    return end < 0 ? source.length : end + 2;
  }
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < source.length) {
      if (source[j] === c) {
        if (source[j + 1] === c) { j += 2; continue; }
        return j + 1;
      }
      j += 1;
    }
    return source.length;
  }
  return -1;
}

/** Línea formada solo por `/` que empieza en `i` (inicio de línea). Devuelve el fin de esa línea o -1. */
function slashLine(source: string, lineStart: number): number {
  const end = source.indexOf("\n", lineStart);
  const line = source.slice(lineStart, end < 0 ? source.length : end);
  return line.trim() === "/" ? (end < 0 ? source.length : end + 1) : -1;
}

function firstWords(source: string, i: number) {
  return source.slice(i, i + 120).toUpperCase().replace(/\s+/g, " ");
}

function isPlsqlStart(head: string) {
  if (/^(?:DECLARE|BEGIN)\b/.test(head)) return true;
  const create = /^CREATE (?:OR REPLACE )?(?:(?:NON)?EDITIONABLE )?(.*)$/.exec(head);
  return !!create && PLSQL_UNITS.test(create[1]);
}

function trimEnd(source: string, from: number, to: number) {
  while (to > from && /\s/.test(source[to - 1])) to -= 1;
  return to;
}

export function splitScript(source: string): ScriptStatement[] {
  const out: ScriptStatement[] = [];
  let i = 0;
  const push = (kind: StatementKind, from: number, to: number) => {
    const end = trimEnd(source, from, to);
    if (end > from) out.push({ kind, text: source.slice(from, end), from, to: end });
  };

  while (i < source.length) {
    // Saltar espacios, comentarios y terminadores sueltos entre sentencias.
    if (/\s|;/.test(source[i])) { i += 1; continue; }
    if (source.startsWith("--", i) || source.startsWith("/*", i)) { i = skipOpaque(source, i); continue; }
    const lineStart = source.lastIndexOf("\n", i - 1) + 1;
    if (source[i] === "/" && slashLine(source, lineStart) > 0) { i = slashLine(source, lineStart); continue; }

    const start = i;
    const head = firstWords(source, start);
    const firstWord = /^[A-Z_$#]+/.exec(head)?.[0] ?? "";
    if (source[start] === "@" || SQLPLUS.has(firstWord)) {
      const end = source.indexOf("\n", start);
      const stop = end < 0 ? source.length : end;
      push("sqlplus", start, stop);
      i = stop;
      continue;
    }

    const plsql = isPlsqlStart(head);
    let j = start;
    let end = source.length;
    let next = source.length;
    while (j < source.length) {
      const skip = skipOpaque(source, j);
      if (skip > 0) { j = skip; continue; }
      if (source[j] === "\n") {
        const after = slashLine(source, j + 1);
        if (after > 0) { end = j; next = after; break; }
      }
      if (!plsql && source[j] === ";") { end = j; next = j + 1; break; }
      j += 1;
    }
    push(plsql ? "plsql" : "sql", start, end);
    i = next;
  }
  return out;
}

/** La sentencia que contiene `position`, o la última que termina antes; si no hay, la primera. */
export function statementAt(list: ScriptStatement[], position: number): ScriptStatement | null {
  let best: ScriptStatement | null = null;
  for (const statement of list) {
    if (statement.from <= position) best = statement;
    else break;
  }
  return best ?? list[0] ?? null;
}
