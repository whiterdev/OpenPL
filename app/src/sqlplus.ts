export type SqlplusCommand =
  | { kind: "exec"; block: string }
  | { kind: "set"; option: string; value: string }
  | { kind: "show"; what: string }
  | { kind: "define"; variable?: string; value?: string }
  | { kind: "undefine"; variable: string }
  | { kind: "variable"; variable: string; type: string }
  | { kind: "print"; variable?: string }
  | { kind: "spool"; target: string }
  | { kind: "start"; path: string; nested: boolean }
  | { kind: "desc"; target: string }
  | { kind: "unsupported"; text: string };

const unsupported = new Set([
  "PROMPT", "COLUMN", "COL", "CONNECT", "CONN", "DISCONNECT", "WHENEVER",
  "ACCEPT", "PAUSE", "REM", "REMARK", "CLEAR", "BREAK", "COMPUTE", "TTITLE",
  "BTITLE", "HOST", "EXIT", "QUIT", "TIMING",
]);

function unquote(value: string): string {
  const first = value[0];
  return value.length > 1 && (first === '"' || first === "'") && value.endsWith(first)
    ? value.slice(1, -1)
    : value;
}

export function parseSqlplus(line: string): SqlplusCommand | null {
  const text = line.trim();
  const script = /^(@@?)\s*(.*)$/.exec(text);
  if (script) return { kind: "start", path: unquote(script[2]), nested: script[1] === "@@" };

  const match = /^(\S+)(?:\s+(.*))?$/.exec(text);
  if (!match) return null;
  const keyword = match[1].toUpperCase();
  const args = match[2] ?? "";
  const [, word = "", rest = ""] = /^(\S+)(?:\s+(.*))?$/.exec(args) ?? [];
  switch (keyword) {
    case "EXEC":
    case "EXECUTE": {
      const call = args.replace(/;\s*$/, "");
      return call ? { kind: "exec", block: "BEGIN " + call + "; END;" } : { kind: "unsupported", text };
    }
    case "SET": return { kind: "set", option: word.toLowerCase(), value: rest };
    case "SHOW": return { kind: "show", what: args };
    case "DEFINE": {
      if (!args) return { kind: "define" };
      const [variable, value] = args.split(/\s*=\s*(.*)/s);
      return value === undefined ? { kind: "define", variable } : { kind: "define", variable, value: unquote(value) };
    }
    case "UNDEFINE": return { kind: "undefine", variable: args };
    case "VAR":
    case "VARIABLE": return { kind: "variable", variable: word, type: rest };
    case "PRINT": return args ? { kind: "print", variable: args } : { kind: "print" };
    case "SPOOL":
    case "SPO": return { kind: "spool", target: args.toLowerCase() === "off" ? "off" : unquote(args) };
    case "START": return { kind: "start", path: unquote(args), nested: false };
    case "DESC":
    case "DESCRIBE": return { kind: "desc", target: args };
    default: return unsupported.has(keyword) ? { kind: "unsupported", text } : null;
  }
}
