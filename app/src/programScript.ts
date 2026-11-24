import type { ObjectInfo } from "./types";

export type CompilationTarget = Pick<ObjectInfo, "owner" | "name">;

const identifier = '(?:"[^"\\r\\n]+"|[\\p{L}][\\p{L}\\p{N}_$#]*)';
const header = new RegExp(
  `^(\\s*CREATE\\s+OR\\s+REPLACE\\s+(?:(?:NON)?EDITIONABLE\\s+)?((?:PACKAGE|TYPE)(?:\\s+BODY)?|PROCEDURE|FUNCTION|TRIGGER)\\s+)(${identifier})(?:\\s*\\.\\s*(${identifier}))?(?=\\s|\\(|;|$)`,
  "iu",
);

const dictionaryName = (name: string) =>
  name.startsWith('"') ? name.slice(1, -1) : name.toUpperCase();
const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Califica el encabezado para que la ejecución manual apunte al objeto abierto. */
export function prepareProgramScript(
  source: string,
  kind: string,
  target: CompilationTarget,
): string {
  const { statement, qualified } = qualify(source, kind, target);
  return `SET DEFINE OFF\nSET SQLBLANKLINES ON\n${statement}\n/\nSHOW ERRORS ${kind} ${qualified}\n`;
}

/** Sentencia DDL para OCI: sin "/" ni comandos de SQL*Plus, conserva el ";" final del bloque. */
export function compileStatement(
  source: string,
  kind: string,
  target: CompilationTarget,
): string {
  return qualify(source, kind, target).statement;
}

function qualify(source: string, kind: string, target: CompilationTarget) {
  const text = source
    .replace(/\r\n?/g, "\n")
    .trimEnd()
    .replace(/\n[ \t]*\/$/, "");
  if (/^[ \t]*\/[ \t]*$/m.test(text))
    throw new Error("Hay más de un bloque en el borrador.");
  const match = header.exec(text);
  if (!match) throw new Error("Encabezado CREATE OR REPLACE inválido.");

  const [, prefix, declaredKind, first, second] = match;
  const owner = second ? dictionaryName(first) : target.owner;
  const name = dictionaryName(second ?? first);
  const remainder = text.slice(match[0].length);
  if (
    declaredKind.toUpperCase().replace(/\s+/g, " ") !== kind ||
    owner !== target.owner ||
    name !== target.name ||
    /^[.@]/.test(remainder.trimStart())
  ) {
    throw new Error("El encabezado no coincide con el objeto abierto.");
  }

  const qualified = `${quoted(owner)}.${quoted(name)}`;
  return { statement: `${prefix.trimStart()}${qualified}${remainder}`, qualified };
}
