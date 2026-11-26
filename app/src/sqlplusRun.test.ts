import { expect, test, vi } from "vitest";
import { parseSqlplus } from "./sqlplus";
import { runSqlplus, substituteDefines, timingLine } from "./sqlplusRun";
import { createSqlplusState } from "./sqlplusState";

function setup() {
  const state = createSqlplusState();
  const ctx = { print: vi.fn(), ask: vi.fn(async (): Promise<string | null> => "7"), query: vi.fn() };
  return { state, ctx, run: (text: string) => runSqlplus(parseSqlplus(text)!, state, ctx) };
}

test("SET actualiza el estado y valida antes de cambiarlo", async () => {
  const { state, ctx, run } = setup();
  expect(state.settings).toMatchObject({ linesize: 80, pagesize: 14 });
  await run("set linesize 120");
  await run("set pagesize 0");
  await run("set heading off");
  await run("set timing on");
  await run("set serveroutput on size 5000");
  await run("set linesize -1");
  expect(state.settings).toMatchObject({ linesize: 120, pagesize: 0, heading: false, timing: true, serveroutput: true });
  await run("set demo foo");
  expect(ctx.print).toHaveBeenLastCalledWith("Comando no admitido: SET DEMO");
});

test("DEFINE conserva valores y pide una vez los faltantes", async () => {
  const { state, ctx, run } = setup();
  await run("define dept = 10");
  await run("define");
  expect(ctx.print).toHaveBeenCalledWith("DEPT = 10");
  expect(await substituteDefines("select &dept, &id, &&ID from dual", state, ctx.ask)).toBe("select 10, 7, 7 from dual");
  expect(ctx.ask).toHaveBeenCalledExactlyOnceWith("id");
  await run("undefine dept");
  ctx.ask.mockResolvedValueOnce(null);
  expect(await substituteDefines("select &dept from dual", state, ctx.ask)).toBeNull();
});

test("VARIABLE declara binds y PRINT muestra valores", async () => {
  const { state, ctx, run } = setup();
  await run("variable id number");
  await run("variable name varchar2(20)");
  await run("variable bad refcursor");
  expect(state.vars.get("ID")).toEqual({ type: "Number", value: null });
  expect(state.vars.get("NAME")).toEqual({ type: "Text", value: null });
  expect(state.vars.has("BAD")).toBe(false);
  state.vars.get("ID")!.value = "7";
  await run("print id");
  expect(ctx.print).toHaveBeenLastCalledWith("ID = 7");
  expect(timingLine(120)).toBe("Transcurrido: 00:00:00.12");
});

test("@@ resuelve junto al script principal y limita la profundidad", async () => {
  const { state, ctx } = setup();
  const readFile = vi.fn(async () => ({ name: "otro.sql", path: "C:\\docs\\otro.sql", source: "select 1 from dual" }));
  const runScript = vi.fn();
  const script = { path: "C:\\docs\\demo.sql", depth: 1 };
  const command = parseSqlplus("@@otro")!;
  await runSqlplus(command, state, { ...ctx, readFile, runScript, script });
  expect(readFile).toHaveBeenCalledExactlyOnceWith("C:\\docs\\otro");
  expect(runScript).toHaveBeenCalledWith("select 1 from dual", { path: "C:\\docs\\otro.sql", depth: 2 });
  expect(ctx.print).toHaveBeenCalledWith("@ C:\\docs\\otro.sql");
  await runSqlplus(command, state, { ...ctx, readFile, runScript, script: { ...script, depth: 5 } });
  expect(readFile).toHaveBeenCalledOnce();
  expect(ctx.print).toHaveBeenLastCalledWith(expect.stringContaining("5"), "error");
});

test("SPOOL recoge la salida, cambia de archivo y guarda al terminar", async () => {
  const { state, ctx } = setup();
  const writeFile = vi.fn(async (path: string, _text: string) => path + ".lst");
  const run = (text: string) => runSqlplus(parseSqlplus(text)!, state, { ...ctx, writeFile });
  await run("spool uno");
  await run("define x = 1");
  await run("define");
  await run("spool dos");
  expect(writeFile).toHaveBeenCalledExactlyOnceWith("uno", "X = 1\n");
  await run("spool");
  expect(ctx.print).toHaveBeenLastCalledWith("SPOOL: dos");
  await run("spool off");
  expect(writeFile).toHaveBeenLastCalledWith("dos", "SPOOL: dos\n");
  expect(ctx.print).toHaveBeenLastCalledWith("Salida guardada en dos.lst");
});
