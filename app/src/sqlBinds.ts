// Variables de la Ventana SQL: binds (:x) que se envían a Oracle y sustituciones (&x) que se reemplazan antes.

export interface SqlVariable {
  kind: "bind" | "subst";
  /** Como está escrito, sin `:` ni `&`. */
  name: string;
  /** Nombre normalizado para recordar el valor (Oracle no distingue mayúsculas en binds sin comillas). */
  key: string;
}

type Visit = (index: number, char: string) => number | void;

// Recorre el texto saltando literales y comentarios; `visit` puede devolver el índice siguiente.
function scan(source: string, visit: Visit) {
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "-" && next === "-") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < source.length && !(source[j] === c && source[j + 1] !== c))
        j += source[j] === c ? 2 : 1;
      i = j + 1;
    } else {
      const jump = visit(i, c);
      i = typeof jump === "number" ? jump : i + 1;
    }
  }
}

const NAME = /^[\p{L}_][\p{L}\p{N}_$#]*/u;

export function findVariables(source: string): SqlVariable[] {
  if (/^\s*create\b/i.test(source)) return [];
  const found = new Map<string, SqlVariable>();
  scan(source, (i, c) => {
    if (
      c === ":" &&
      source[i + 1] !== "=" &&
      !/[\p{L}\p{N}_:]/u.test(source[i - 1] ?? "")
    ) {
      const name = NAME.exec(source.slice(i + 1))?.[0];
      if (!name) return;
      const key = name.toUpperCase();
      if (!found.has(`bind ${key}`))
        found.set(`bind ${key}`, { kind: "bind", name, key });
      return i + 1 + name.length;
    }
    if (c === "&") {
      const amp = source[i + 1] === "&" ? 2 : 1;
      const name = NAME.exec(source.slice(i + amp))?.[0];
      if (!name) return;
      const key = name.toUpperCase();
      if (!found.has(`subst ${key}`))
        found.set(`subst ${key}`, { kind: "subst", name, key });
      return i + amp + name.length;
    }
  });
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
