// Variables de la Ventana SQL: binds (:x) que se envían a Oracle y sustituciones (&x) que se reemplazan antes.

import { skipOpaque, splitScript } from "./sqlScript";

export interface SqlVariable {
  kind: "bind" | "subst";
  /** Como está escrito, sin `:` ni `&`. */
  name: string;
  /** Nombre normalizado para recordar el valor (Oracle no distingue mayúsculas en binds sin comillas). */
  key: string;
  uses: number;
}

type Visit = (index: number, char: string) => number | void;

// Recorre el texto saltando literales y comentarios; `visit` puede devolver el índice siguiente.
function scan(source: string, visit: Visit) {
  let i = 0;
  while (i < source.length) {
    const end = skipOpaque(source, i);
    i = end > i ? end : visit(i, source[i]) ?? i + 1;
  }
}

const NAME = /^[\p{L}_][\p{L}\p{N}_$#]*/u;

export function assignedBinds(sql: string): Set<string> {
  const names = new Set<string>();
  const assignment = /:([\p{L}_][\p{L}\p{N}_$#]*)\s*:=/uy;
  scan(sql, (index, char) => {
    if (char !== ":") return;
    assignment.lastIndex = index;
    const match = assignment.exec(sql);
    if (match) {
      names.add(match[1].toUpperCase());
      return assignment.lastIndex;
    }
  });
  return names;
}

export function findVariables(script: string): SqlVariable[] {
  const found = new Map<string, SqlVariable>();
  function count(kind: SqlVariable["kind"], name: string) {
    const key = name.toUpperCase();
    const id = `${kind} ${key}`;
    const previous = found.get(id);
    if (previous) previous.uses += 1;
    else found.set(id, { kind, name, key, uses: 1 });
  }
  for (const { text } of splitScript(script)) {
    if (/^create\b/i.test(text)) continue;
    scan(text, (i, c) => {
      if (
        c === ":" &&
        text[i + 1] !== "=" &&
        !/[\p{L}\p{N}_:]/u.test(text[i - 1] ?? "")
      ) {
        const name = NAME.exec(text.slice(i + 1))?.[0];
        if (!name) return;
        count("bind", name);
        return i + 1 + name.length;
      }
      if (c === "&") {
        const amp = text[i + 1] === "&" ? 2 : 1;
        const name = NAME.exec(text.slice(i + amp))?.[0];
        if (!name) return;
        count("subst", name);
        return i + amp + name.length;
      }
    });
  }
  return [...found.values()];
}

/** Reemplaza `&x` y `&&x` por el valor guardado con la clave `X`; sin valor, deja el texto como está. */
export function applySubstitutions(
  source: string,
  values: Record<string, string>,
): string {
  let out = "";
  let last = 0;
  scan(source, (i, c) => {
    if (c !== "&") return;
    const amp = source[i + 1] === "&" ? 2 : 1;
    const name = NAME.exec(source.slice(i + amp))?.[0];
    if (!name) return;
    const value = values[name.toUpperCase()];
    if (value === undefined) return i + amp + name.length;
    out += source.slice(last, i) + value;
    last = i + amp + name.length;
    return last;
  });
  return out + source.slice(last);
}
