import { applySubstitutions, findVariables } from "./sqlBinds";
import type { SqlplusCommand } from "./sqlplus";
import type { SqlplusState } from "./sqlplusState";
import { describeError, type BindKind, type BindValue, type ExecOutcome } from "./types";
import { createdObject, describeObject, printQuery, showErrorsQuery, showUserQuery } from "./sqlplusQueries";

interface ScriptLocation {
  path: string;
  depth: number;
}

export interface SqlplusCtx {
  print(line: string, kind?: "info" | "output" | "error"): void;
  ask(name: string): Promise<string | null>;
  query(sql: string, binds?: BindValue[]): Promise<ExecOutcome>;
  readFile?(path: string): Promise<{ name: string; path: string; source: string }>;
  writeFile?(path: string, text: string): Promise<string>;
  runScript?(source: string, script: ScriptLocation): Promise<void>;
  script?: ScriptLocation;
}

export async function substituteDefines(
  sql: string,
  state: SqlplusState,
  ask: SqlplusCtx["ask"],
): Promise<string | null> {
  const values: Record<string, string> = Object.create(null);
  for (const variable of findVariables(sql)) {
    if (variable.kind !== "subst") continue;
    const value = state.defines.get(variable.key) ?? await ask(variable.name);
    if (value === null) return null;
    values[variable.key] = value;
  }
  return applySubstitutions(sql, values);
}

function setOption(option: string, input: string, state: SqlplusState, ctx: SqlplusCtx) {
  const value = input.trim().toUpperCase();
  const bool = value === "ON" ? true : value === "OFF" ? false : undefined;
  const number = /^\d+$/.test(value) ? Number(value) : NaN;
  const settings = state.settings;
  switch (option) {
    case "linesize":
    case "pagesize":
      if (Number.isSafeInteger(number) && number >= (option === "linesize" ? 1 : 0)) {
        settings[option] = number;
        return;
      }
      break;
    case "heading":
    case "timing":
      if (bool !== undefined) {
        settings[option] = bool;
        return;
      }
      break;
    case "feedback":
      if (bool !== undefined || Number.isSafeInteger(number)) {
        settings.feedback = bool ?? number;
        return;
      }
      break;
    case "serveroutput": {
      const match = /^(ON|OFF)(?:\s+SIZE\s+(\d+))?$/.exec(value);
      const size = match?.[2] ? Number(match[2]) : undefined;
      if (match && (size === undefined || (match[1] === "ON" && Number.isSafeInteger(size) && size > 0))) {
        settings.serveroutput = match[1] === "ON";
        settings.serveroutputSize = size;
        return;
      }
      break;
    }
    default:
      ctx.print("Comando no admitido: SET " + option.toUpperCase());
      return;
  }
  ctx.print("Valor inválido para SET " + option.toUpperCase(), "error");
}

function variableType(input: string): BindKind | null {
  const value = input.trim().toUpperCase();
  if (/^(?:VARCHAR2?|CHAR|TEXT)(?:\s*\(\s*\d+\s*\))?$/.test(value)) return "Text";
  if (value === "NUMBER") return "Number";
  if (value === "DATE") return "Date";
  return null;
}

export function printSqlplus(
  state: SqlplusState,
  print: SqlplusCtx["print"],
  line: string,
  kind?: Parameters<SqlplusCtx["print"]>[1],
) {
  state.spool?.lines.push(line);
  if (kind === undefined) print(line);
  else print(line, kind);
}

async function startScript(cmd: Extract<SqlplusCommand, { kind: "start" }>, ctx: SqlplusCtx) {
  const depth = (ctx.script?.depth ?? 0) + 1;
  if (depth > 5) {
    ctx.print("Máximo de 5 scripts anidados", "error");
    return;
  }
  if (!cmd.path || !ctx.readFile || !ctx.runScript) {
    ctx.print("Script no disponible", "error");
    return;
  }
  const parent = ctx.script?.path ?? "";
  const base = parent.slice(0, Math.max(parent.lastIndexOf("/"), parent.lastIndexOf("\\")) + 1);
  const path = cmd.nested && !/^(?:[a-z]:|[\\/])/i.test(cmd.path) ? base + cmd.path : cmd.path;
  try {
    const file = await ctx.readFile(path);
    ctx.print("@ " + file.path);
    await ctx.runScript(file.source, { path: file.path, depth });
  } catch (error) {
    ctx.print("Error de script: " + describeError(error).message, "error");
  }
}

async function spool(target: string, state: SqlplusState, ctx: SqlplusCtx) {
  if (!target) {
    ctx.print(state.spool ? "SPOOL: " + state.spool.path : "SPOOL desactivado");
    return;
  }
  if (!ctx.writeFile) {
    ctx.print("SPOOL no disponible", "error");
    return;
  }
  if (state.spool) {
    const { path, lines } = state.spool;
    try {
      const resolved = await ctx.writeFile(path, lines.length ? lines.join("\n") + "\n" : "");
      delete state.spool;
      ctx.print("Salida guardada en " + resolved);
    } catch (error) {
      ctx.print("Error de SPOOL: " + describeError(error).message, "error");
      return;
    }
  }
  if (target !== "off") state.spool = { path: target, lines: [] };
}

export async function runSqlplus(cmd: SqlplusCommand, state: SqlplusState, context: SqlplusCtx): Promise<void> {
  const ctx = { ...context, print: (line: string, kind?: Parameters<SqlplusCtx["print"]>[1]) =>
    printSqlplus(state, context.print, line, kind) };
  switch (cmd.kind) {
    case "start":
      await startScript(cmd, ctx);
      return;
    case "spool":
      await spool(cmd.target, state, ctx);
      return;
    case "show": {
      const option = cmd.what.trim().toUpperCase();
      if (option === "USER") {
        const { sql, binds } = showUserQuery;
        printQuery(await ctx.query(sql, binds), state, ctx);
      } else if (option === "ERRORS") {
        const object = state.lastCreated && createdObject(state.lastCreated);
        if (!object) ctx.print("Sin objeto reciente");
        else {
          const { sql, binds } = showErrorsQuery(object);
          printQuery(await ctx.query(sql, binds), state, ctx);
        }
      } else ctx.print("Comando no admitido: SHOW " + cmd.what);
      return;
    }
    case "desc":
      await describeObject(cmd.target, state, ctx);
      return;
    case "set":
      setOption(cmd.option, cmd.value, state, ctx);
      return;
    case "define":
      if (cmd.variable && cmd.value !== undefined) {
        state.defines.set(cmd.variable.toUpperCase(), cmd.value);
      } else {
        const variable = cmd.variable?.toUpperCase();
        for (const [name, value] of state.defines) {
          if (!variable || name === variable) ctx.print(name + " = " + value);
        }
      }
      return;
    case "undefine":
      state.defines.delete(cmd.variable.toUpperCase());
      return;
    case "variable": {
      const type = variableType(cmd.type);
      if (type && /^[\p{L}_][\p{L}\p{N}_$#]*$/u.test(cmd.variable)) {
        state.vars.set(cmd.variable.toUpperCase(), { type, value: null });
      } else {
        ctx.print("Variable o tipo inválido", "error");
      }
      return;
    }
    case "print": {
      const variable = cmd.variable?.toUpperCase();
      if (variable && !state.vars.has(variable)) {
        ctx.print("Variable no declarada: " + variable, "error");
        return;
      }
      for (const [name, { value }] of state.vars) {
        if (!variable || name === variable) ctx.print(name + " = " + (value ?? "NULL"));
      }
      return;
    }
    case "unsupported":
      ctx.print("Comando no admitido: " + cmd.text);
      return;
    default:
      ctx.print("Comando no admitido: " + cmd.kind.toUpperCase());
  }
}

export function timingLine(ms: number): string {
  const hundredths = Math.floor(Math.max(0, ms) / 10);
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(hundredths / 360_000);
  const minutes = Math.floor(hundredths / 6_000) % 60;
  const seconds = Math.floor(hundredths / 100) % 60;
  return "Transcurrido: " + [hours, minutes, seconds].map(pad).join(":") + "." + pad(hundredths % 100);
}
