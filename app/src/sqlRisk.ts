import { skipOpaque, type ScriptStatement, type StatementKind } from "./sqlScript";

export function statementRisk(sql: string, kind: StatementKind): "read" | "write" {
  if (kind !== "sql") return "write";
  const word = /[a-z_][\w$#]*/iy;
  let first = "";
  let previous = "";
  for (let i = 0; i < sql.length;) {
    const end = skipOpaque(sql, i);
    if (end > i) {
      i = end;
      continue;
    }
    word.lastIndex = i;
    const matched = word.exec(sql);
    if (!matched) {
      i += 1;
      continue;
    }
    const token = matched[0].toUpperCase();
    i = word.lastIndex;
    if (!first) {
      first = token;
      if (first === "EXPLAIN") return "read";
      if (first !== "SELECT" && first !== "WITH") return "write";
    }
    if (previous === "FOR" && token === "UPDATE") return "write";
    if (first === "WITH" && (token === "FUNCTION" || token === "PROCEDURE")) return "write";
    previous = token;
  }
  return first ? "read" : "write";
}

export function needsConfirm(statements: readonly ScriptStatement[]): string | null {
  const writes = statements.filter(({ text, kind }) => statementRisk(text, kind) === "write").length;
  return writes ? writes + " de escritura" : null;
}
