import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { SqlWindow } from "./SqlWindow";
import type { ProgramActions } from "./ProgramWindow";
import { api } from "../api";
import type { ExecOutcome } from "../types";
import "./ProgramWindow.css";

afterEach(() => vi.restoreAllMocks());

const query = (rows: (string | null)[][], more = false, cursor = 1): ExecOutcome => ({
  result: {
    kind: "Query", cursor,
    columns: [{ name: "ID", type_name: "NUMBER", numeric: true }, { name: "NOMBRE", type_name: "VARCHAR2(40)", numeric: false }],
    page: { rows, more },
  },
  elapsed_ms: 40, output: [], transaction: false,
});

function setup(source: string, props: Partial<Parameters<typeof SqlWindow>[0]> = {}) {
  const ref = createRef<ProgramActions>();
  const onTransaction = vi.fn();
  render(<SqlWindow ref={ref} sessionId="w1" initialSql={source} onTransaction={onTransaction} onDirty={vi.fn()} {...props} />);
  const view = EditorView.findFromDOM(screen.getByRole("textbox", { name: "SQL" }).closest<HTMLElement>(".cm-editor")!)!;
  return { ref, view, onTransaction };
}

test("F8 ejecuta la sentencia bajo el cursor y muestra la grilla", async () => {
  const exec = vi.spyOn(api, "sqlExecute").mockResolvedValue(query([["1", "Ana"], ["2", null]]));
  const source = "select 1 from dual;\nselect id, nombre from clientes;";
  const { ref, view } = setup(source);
  act(() => view.dispatch({ selection: { anchor: source.indexOf("clientes") } }));
  await act(async () => ref.current!.execute!());
  expect(exec).toHaveBeenCalledWith("w1", "select id, nombre from clientes", []);
  const grid = screen.getByRole("grid", { name: "Resultados" });
  expect(within(grid).getByRole("columnheader", { name: "NOMBRE" })).toBeInTheDocument();
  expect(within(grid).getByText("Ana")).toBeInTheDocument();
  expect(within(grid).getByText("NULL")).toHaveClass("sql-null");
  expect(screen.getByText("2 filas · 40 ms")).toBeInTheDocument();
});

test("trae más filas y Traer todas completa la consulta", async () => {
  vi.spyOn(api, "sqlExecute").mockResolvedValue(query([["1", "Ana"]], true, 7));
  const fetch = vi.spyOn(api, "sqlFetch")
    .mockResolvedValueOnce({ rows: [["2", "Beto"]], more: true })
    .mockResolvedValueOnce({ rows: [["3", "Caro"]], more: false });
  const { ref } = setup("select id, nombre from clientes");
  await act(async () => ref.current!.execute!());
  expect(screen.getByText("1 fila · 40 ms · hay más")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Traer todas" }));
  expect(await screen.findByText("Caro")).toBeInTheDocument();
  expect(fetch).toHaveBeenNthCalledWith(1, "w1", 7, 1000);
  expect(screen.getByText("3 filas · 40 ms")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Traer todas" })).not.toBeInTheDocument();
});

test("un error marca la posición, va a Salida y detiene el script", async () => {
  const exec = vi.spyOn(api, "sqlExecute").mockRejectedValue({
    Db: { code: "ORA-00942", kind: "Other", message: "ORA-00942: la tabla o vista no existe", offset: 14 },
  });
  const source = "select * from nada;\nselect 1 from dual;";
  const { ref, view } = setup(source);
  await act(async () => ref.current!.executeScript!());
  expect(exec).toHaveBeenCalledTimes(1);
  const output = screen.getByRole("tabpanel", { name: "Salida" });
  expect(within(output).getByText("ORA-00942: la tabla o vista no existe")).toBeInTheDocument();
  await waitFor(() => expect(view.dom.querySelector(".cm-lintRange-error")).not.toBeNull());
});

test("el script omite SQL*Plus, junta DBMS_OUTPUT y avisa la transacción", async () => {
  const exec = vi.spyOn(api, "sqlExecute")
    .mockResolvedValueOnce({ result: { kind: "Done", message: "1 fila actualizada" }, elapsed_ms: 3, output: [], transaction: true })
    .mockResolvedValueOnce({ result: { kind: "Done", message: "Bloque ejecutado" }, elapsed_ms: 2, output: ["hola"], transaction: true });
  const { ref, onTransaction } = setup("set serveroutput on\nupdate t set a = 1;\nbegin dbms_output.put_line('hola'); end;\n/");
  await act(async () => ref.current!.executeScript!());
  expect(exec).toHaveBeenCalledTimes(2);
  const output = within(screen.getByRole("tabpanel", { name: "Salida" }));
  expect(output.getByText("Omitido (SQL*Plus): set serveroutput on")).toBeInTheDocument();
  expect(output.getByText("1 fila actualizada")).toBeInTheDocument();
  expect(output.getByText("hola")).toBeInTheDocument();
  expect(onTransaction).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("tab", { name: /Historial/ }));
  const history = within(screen.getByRole("tabpanel", { name: "Historial" }));
  expect(history.getAllByRole("button")[0]).toHaveTextContent("begin dbms_output.put_line('hola'); end;");
});

test("pide y envía los valores de las variables", async () => {
  const exec = vi.spyOn(api, "sqlExecute").mockResolvedValue(query([]));
  const { ref } = setup("select * from &tabla where ciudad = :ciudad and alta > :desde");
  const panel = within(screen.getByRole("complementary", { name: "Variables" }));
  fireEvent.change(panel.getByRole("textbox", { name: "Valor de &tabla" }), { target: { value: "hr.clientes" } });
  fireEvent.change(panel.getByRole("textbox", { name: "Valor de :ciudad" }), { target: { value: "Lima" } });
  fireEvent.change(panel.getByRole("textbox", { name: "Valor de :desde" }), { target: { value: "2026-01-01" } });
  fireEvent.change(panel.getByRole("combobox", { name: "Tipo de :desde" }), { target: { value: "Date" } });
  await act(async () => ref.current!.execute!());
  expect(exec).toHaveBeenCalledWith("w1", "select * from hr.clientes where ciudad = :ciudad and alta > :desde", [
    { name: "ciudad", value: "Lima", kind: "Text" },
    { name: "desde", value: "2026-01-01", kind: "Date" },
  ]);
  expect(screen.getByText("La consulta no devolvió filas")).toBeInTheDocument();
});

test("sin valor para una sustitución no ejecuta", async () => {
  const exec = vi.spyOn(api, "sqlExecute");
  const { ref } = setup("select * from &tabla");
  await act(async () => ref.current!.execute!());
  expect(exec).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Falta el valor de &tabla");
});

test("Cancelar interrumpe la ejecución en curso", async () => {
  let reject!: (e: unknown) => void;
  vi.spyOn(api, "sqlExecute").mockReturnValue(new Promise((_, no) => { reject = no; }));
  const cancel = vi.spyOn(api, "sqlCancel").mockResolvedValue(true);
  const { ref } = setup("select * from grande");
  act(() => ref.current!.execute!());
  expect(screen.getByText("Ejecutando…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Cancelar ejecución/ }));
  expect(cancel).toHaveBeenCalledWith("w1");
  await act(async () => reject({ Db: { code: "ORA-01013", kind: "Other", message: "ORA-01013: user requested cancel" } }));
  expect(within(screen.getByRole("tabpanel", { name: "Salida" })).getByText("Ejecución cancelada")).toBeInTheDocument();
});

test("sin ejecuciones, Resultados indica cómo empezar", () => {
  setup("");
  expect(screen.getByText("Sin resultados. Ejecuta con F8.")).toBeInTheDocument();
});

test("las pestañas de resultado se recorren con flechas", () => {
  setup("");
  const results = screen.getByRole("tab", { name: "Resultados" });
  results.focus();
  fireEvent.keyDown(results, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Salida" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Salida" })).toHaveFocus();
});
