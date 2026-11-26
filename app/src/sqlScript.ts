// Divide un script en sentencias para la Ventana SQL. Las posiciones son del texto original.

import { parseSqlplus, type SqlplusCommand } from "./sqlplus";

export type StatementKind = "sql" | "plsql" | "sqlplus";

export interface ScriptStatement {
  kind: StatementKind;
  /** Texto a ejecutar: sin el `;` final en SQL, con el `END;` en PL/SQL. */
  text: string;
  from: number;
  to: number;
  command?: SqlplusCommand;
}

const PLSQL_UNITS =
  /^(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|LIBRARY|JAVA)\b/;
const CLOSERS: Record<string, string> = {
  "[": "]",
  "(": ")",
  "{": "}",
  "<": ">",
};

/** Si en `i` empieza un literal o comentario, devuelve dónde termina; si no, -1. */
export function skipOpaque(source: string, i: number): number {
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
  if (
    /[qn]/i.test(c ?? "") &&
    !/[\w$#]/.test(source[i - 1] ?? "")
  ) {
    const quote = c.toLowerCase() === "n" && /q/i.test(next ?? "") ? i + 2 : i + 1;
    if (source[quote] === "'" && quote + 1 < source.length && /q/i.test(source[quote - 1])) {
      const open = source[quote + 1];
      const close = CLOSERS[open] ?? open;
      const end = source.indexOf(`${close}'`, quote + 2);
      return end < 0 ? source.length : end + 2;
    }
  }
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < source.length) {
      if (source[j] === c) {
        if (source[j + 1] === c) {
          j += 2;
          continue;
        }
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
  return source
    .slice(i, i + 120)
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isPlsqlStart(head: string) {
  if (/^(?:DECLARE|BEGIN)\b/.test(head)) return true;
  const create = /^CREATE (?:OR REPLACE )?(?:(?:NON)?EDITIONABLE )?(.*)$/.exec(
    head,
  );
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
    if (end > from)
      out.push({ kind, text: source.slice(from, end), from, to: end });
  };

  while (i < source.length) {
    // Saltar espacios, comentarios y terminadores sueltos entre sentencias.
    if (/\s|;/.test(source[i])) {
      i += 1;
      continue;
    }
    if (source.startsWith("--", i) || source.startsWith("/*", i)) {
      i = skipOpaque(source, i);
      continue;
    }
    const lineStart = source.lastIndexOf("\n", i - 1) + 1;
    if (source[i] === "/" && slashLine(source, lineStart) > 0) {
      i = slashLine(source, lineStart);
      continue;
    }

    const start = i;
    const head = firstWords(source, start);
    const lineEnd = source.indexOf("\n", start);
    const stop = lineEnd < 0 ? source.length : lineEnd;
    const command = parseSqlplus(source.slice(start, stop));
    if (command) {
      const to = trimEnd(source, start, stop);
      if (command.kind === "exec") {
        out.push({ kind: "plsql", text: command.block, from: start, to });
      } else {
        out.push({ kind: "sqlplus", text: source.slice(start, to), from: start, to, command });
      }
      i = stop;
      continue;
    }

    const plsql = isPlsqlStart(head);
    const container = /^CREATE (?:OR REPLACE )?(?:(?:NON)?EDITIONABLE )?(?:PACKAGE\b|TYPE BODY\b)/.test(head);
    const words = /[\w$#]+/y;
    let depth = 0;
    let endOfBlock = false;
    let j = start;
    let end = source.length;
    let next = source.length;
    while (j < source.length) {
      const skip = skipOpaque(source, j);
      if (skip > 0) {
        j = skip;
        continue;
      }
      if (source[j] === "\n") {
        const after = slashLine(source, j + 1);
        if (after > 0) {
          end = j;
          next = after;
          break;
        }
      }
      if (!plsql && source[j] === ";") {
        end = j;
        next = j + 1;
        break;
      }
      if (plsql) {
        if (source[j] === ";" && endOfBlock) {
          end = next = j + 1;
          break;
        }
        words.lastIndex = j;
        const token = words.exec(source)?.[0]?.toUpperCase();
        if (token) {
          j = words.lastIndex;
          if (endOfBlock) continue;
          if (token === "BEGIN" || token === "CASE") depth += 1;
          if (token === "END") {
            let following = j;
            while (following < source.length) {
              if (/\s/.test(source[following])) following += 1;
              else if (source.startsWith("--", following) || source.startsWith("/*", following))
                following = skipOpaque(source, following);
              else break;
            }
            words.lastIndex = following;
            const suffix = words.exec(source)?.[0]?.toUpperCase();
            if (suffix === "IF" || suffix === "LOOP" || suffix === "CASE") j = words.lastIndex;
            if (suffix !== "IF" && suffix !== "LOOP") {
              depth -= 1;
              endOfBlock = depth <= (container ? -1 : 0);
            }
          }
          continue;
        }
      }
      j += 1;
    }
    push(plsql ? "plsql" : "sql", start, end);
    i = next;
  }
  return out;
}

/** Un espacio entre sentencias pertenece a la siguiente. */
export function statementAt(
  list: ScriptStatement[],
  position: number,
): ScriptStatement | null {
  return list.find((statement) => position <= statement.to) ?? null;
}
