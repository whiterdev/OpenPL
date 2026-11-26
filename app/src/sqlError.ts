export interface ErrorLocation {
  line: number;
  column: number;
  snippet: string;
  caret: string;
}

export function locateError(
  sql: string,
  { message, offset }: { message: string; offset?: number | null },
): ErrorLocation | null {
  if (offset != null && Number.isInteger(offset) && offset >= 0) {
    const bytes = new TextEncoder().encode(sql);
    if (offset <= bytes.length) {
      const prefix = new TextDecoder().decode(bytes.subarray(0, offset));
      const lines = prefix.split(/\r\n?|\n/);
      return location(sql, lines.length, Array.from(lines[lines.length - 1]).length + 1);
    }
  }
  const coordinates = /\b(?:line|l[íi]nea)\s+(\d+)\s*,?\s*(?:column|columna)\s+(\d+)/i.exec(message);
  return coordinates ? location(sql, Number(coordinates[1]), Number(coordinates[2])) : null;
}

function location(sql: string, line: number, column: number): ErrorLocation | null {
  const snippet = sql.split(/\r\n?|\n/)[line - 1];
  if (snippet === undefined || column < 1) return null;
  const characters = Array.from(snippet);
  if (column > characters.length + 1) return null;
  const caret = characters.slice(0, column - 1).map((char) => char === "\t" ? "\t" : " ").join("") + "^";
  return { line, column, snippet, caret };
}

export function formatConsoleError(
  code: string | null,
  message: string,
  position: ErrorLocation | null,
): string[] {
  const text = code && !message.startsWith(code) ? code + ": " + message : message;
  if (!position) return [text];
  return [text, "Línea " + position.line + ", columna " + position.column, position.snippet, position.caret];
}
