import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ROWID_COLUMN } from "../sqlEdit";
import { SqlWindow } from "./SqlWindow";
import { CommandConsole, type ConsoleIo } from "./CommandConsole";
import type { ProgramActions } from "./ProgramWindow";
import { api } from "../api";
import type { ExecOutcome } from "../types";
import "./ProgramWindow.css";

afterEach(() => vi.restoreAllMocks());

const query = (rows: (string | null)[][], more = false, cursor = 1): ExecOutcome => ({
  result: {
    kind: "Query", cursor,
    columns: [{ name: "ID", type_name: "NUMBER", numeric: true, lob: false }, { name: "NOMBRE", type_name: "VARCHAR2(40)", numeric: false, lob: false }],
    page: { rows, more },
  },
  elapsed_ms: 40, output: [], transaction: false,
});

function setup(source: string, props: Partial<Parameters<typeof SqlWindow>[0]> = {}) {
  const ref = createRef<ProgramActions>();
  const onTransaction = vi.fn();
  render(<SqlWindow ref={ref} sessionId="w1" initialSql={source} onTransaction={onTransaction} onDirty={vi.fn()} {...props} />);
  const editor = screen.queryByRole("textbox", { name: "SQL" });
  const view = (editor && EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!))!;
  return { ref, view, onTransaction };
}

test("EDIT sugiere objetos y abre la selección sin ejecutar SQL", async () => {
  const table = { owner: "HR", name: "VENTAS", object_type: "TABLE" };
  const view = { owner: "HR", name: "VENTAS_V", object_type: "VIEW" };
  vi.spyOn(api, "completeObjects").mockResolvedValue([table, view]);
  const execute = vi.spyOn(api, "sqlExecute");
  const open = vi.fn();
  setup("", { command: true, onEditObject: open });
  const prompt = screen.getByLabelText("Comando SQL");
  fireEvent.change(prompt, { target: { value: "edit vent" } });
  expect(await screen.findByText("VENTAS_V", { exact: true })).toBeVisible();
  expect(api.completeObjects).toHaveBeenLastCalledWith("w1", null, "VENT", null, "edit");
  fireEvent.change(prompt, { target: { value: "edit hr.vent" } });
  expect(await screen.findByText("HR.VENTAS_V", { exact: true })).toBeVisible();
  expect(api.completeObjects).toHaveBeenLastCalledWith("w1", "HR", "VENT", null, "edit");
  fireEvent.keyDown(prompt, { key: "ArrowDown" });
  fireEvent.submit(prompt.closest("form")!);
  expect(open).toHaveBeenCalledWith(view);
  expect(execute).not.toHaveBeenCalled();
});

test("la consola acumula un bloque PL/SQL hasta recibir la barra", async () => {
  const execute = vi.spyOn(api, "sqlExecute").mockResolvedValue({
    result: { kind: "Done", message: "Ejecutado" }, elapsed_ms: 0, output: ["Hola"], transaction: false,
  });
  setup("", { command: true });
  const prompt = screen.getByLabelText("Comando SQL");
  async function enter(value: string) {
    fireEvent.change(prompt, { target: { value } });
    await act(async () => { fireEvent.submit(prompt.closest("form")!); });
  }
  await enter("BEGIN");
  expect(screen.getByText("SQL> BEGIN")).toBeVisible();
  expect(screen.getByText("2", { selector: "label" })).toBeVisible();
  await enter("dbms_output.put_line('Hola');");
  await enter("END;");
  expect(execute).not.toHaveBeenCalled();
  await enter("/");
  expect(execute).toHaveBeenCalledWith("w1", "BEGIN\ndbms_output.put_line('Hola');\nEND;", []);
  expect(screen.getByText("Hola")).toBeVisible();
});

test("la consola ejecuta SQL con Enter y maneja PROMPT localmente", async () => {
  const execute = vi.spyOn(api, "sqlExecute").mockResolvedValue(query([["7", "Ana"]]));
  setup("", { command: true });
  const prompt = screen.getByRole("textbox", { name: "Comando SQL" });
  expect(screen.queryByRole("textbox", { name: "SQL" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  fireEvent.change(prompt, { target: { value: "PROMPT Hola" } });
  await act(async () => { fireEvent.submit(prompt.closest("form")!); });
  expect(screen.getByText("Hola")).toBeVisible();
  expect(execute).not.toHaveBeenCalled();
  fireEvent.change(prompt, { target: { value: "SELECT 7 FROM DUAL;" } });
  await act(async () => { fireEvent.keyDown(prompt, { key: "Enter" }); });
  expect(execute).toHaveBeenCalledWith("w1", "SELECT 7 FROM DUAL", []);
  expect(screen.getByText("SQL> SELECT 7 FROM DUAL;")).toBeVisible();
  expect(screen.getByText(/^7\s+Ana$/)).toBeVisible();
  const transcript = screen.getByRole("log");
  const row = within(transcript).getByText(/^7\s+Ana$/);
  expect(row.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(transcript).toContainElement(prompt);
  fireEvent.keyDown(prompt, { key: "ArrowUp" });
  expect(prompt).toHaveValue("SELECT 7 FROM DUAL;");
});

test("el prompt crece con el contenido dentro de la transcripción", () => {
  setup("", { command: true });
  const prompt = screen.getByLabelText("Comando SQL");
  expect(prompt).not.toHaveClass("fld");
  Object.defineProperty(prompt, "scrollHeight", { value: 36 });
  fireEvent.change(prompt, { target: { value: "SELECT\n1 FROM DUAL" } });
  expect(prompt).toHaveStyle({ height: "36px" });
});

test("la consola recupera el foco y conserva la posición al leer salida anterior", async () => {
  setup("", { command: true });
  const terminal = screen.getByRole("log");
  const prompt = screen.getByLabelText("Comando SQL");
  expect(prompt).toHaveFocus();
  prompt.blur();
  fireEvent.click(terminal);
  expect(prompt).toHaveFocus();
  prompt.blur();
  fireEvent.focus(window);
  expect(prompt).toHaveFocus();
  Object.defineProperties(terminal, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
  terminal.scrollTop = 30;
  fireEvent.scroll(terminal);
  fireEvent.change(prompt, { target: { value: "PROMPT Hola" } });
  await act(async () => { fireEvent.submit(prompt.closest("form")!); });
  expect(screen.getByText("Hola")).toBeVisible();
  expect(terminal.scrollTop).toBe(30);
});

test("la consola conserva la sangría y el historial no intercepta flechas internas", async () => {
  setup("", { command: true });
  const prompt = screen.getByLabelText<HTMLTextAreaElement>("Comando SQL");
  const form = prompt.closest("form")!;
  for (const value of ["PROMPT Anterior", "PROMPT Actual", "PROMPT Actual"]) {
    fireEvent.change(prompt, { target: { value } });
    await act(async () => { fireEvent.submit(form); });
  }
  fireEvent.keyDown(prompt, { key: "ArrowUp" });
  expect(prompt).toHaveValue("PROMPT Actual");
  fireEvent.keyDown(prompt, { key: "ArrowUp" });
  expect(prompt).toHaveValue("PROMPT Anterior");
  fireEvent.change(prompt, { target: { value: "  BEGIN\n    NULL;" } });
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
  expect(fireEvent.keyDown(prompt, { key: "ArrowUp" })).toBe(true);
  expect(fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true })).toBe(true);
  expect(prompt).toHaveValue("  BEGIN\n    NULL;");
  await act(async () => { fireEvent.submit(form); });
  expect(screen.getByText(/SQL>\s+BEGIN/).textContent).toContain("  BEGIN");
});

test("F5 muestra el plan sin ejecutar la sentencia de la pestaña", async () => {
  const explain = vi.spyOn(api, "sqlExplain").mockResolvedValue({
    columns: [{ name: "OPERATION", type_name: "VARCHAR2", numeric: false, lob: false }],
    page: { rows: [["TABLE ACCESS"]], more: false },
  });
  const execute = vi.spyOn(api, "sqlExecute");
  const { ref } = setup("SELECT 1 FROM DUAL;");
  await act(async () => ref.current!.explainPlan!());
  expect(explain).toHaveBeenCalledWith("w1", "SELECT 1 FROM DUAL");
  expect(execute).not.toHaveBeenCalled();
  expect(screen.getByRole("tabpanel", { name: "Plan" })).toHaveTextContent("TABLE ACCESS");
});

test("la consola admite otro comando durante la ejecución y lo ejecuta después", async () => {
  let finish!: () => void;
  const first = new Promise<ReturnType<typeof query>>((resolve) => {
    finish = () => resolve(query([]));
  });
  const execute = vi.spyOn(api, "sqlExecute").mockReturnValueOnce(first).mockResolvedValue(query([]));
  setup("", { command: true });
  const prompt = screen.getByRole("textbox", { name: "Comando SQL" });
  const submit = async (value: string) => {
    fireEvent.change(prompt, { target: { value } });
    await act(async () => { fireEvent.submit(prompt.closest("form")!); });
  };
  await submit("SELECT 1 FROM DUAL;");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(prompt).not.toHaveAttribute("readonly");
  expect(screen.getByText(/Ejecutando 0 s/)).toBeVisible();
  await submit("SELECT 2 FROM DUAL;");
  expect(execute).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  await waitFor(() => expect(execute).toHaveBeenNthCalledWith(2, "w1", "SELECT 2 FROM DUAL", []));
});

test("pegar varias líneas de consola ejecuta las completas y deja la continuación", async () => {
  const execute = vi.spyOn(api, "sqlExecute").mockResolvedValue(query([]));
  setup("", { command: true });
  const prompt = screen.getByLabelText("Comando SQL");
  await act(async () => {
    fireEvent.paste(prompt, { clipboardData: { getData: () => "SELECT 1 FROM DUAL;\r\nSELECT 2 FROM DUAL;\r\nBEGIN" } });
  });
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(screen.getByText("SQL> BEGIN")).toBeVisible();
});

test("io.ask consume una respuesta sin ejecutar otro comando y Escape la cancela", async () => {
  const answers: (string | null)[] = [];
  const onRun = vi.fn(async (_source: string, io: ConsoleIo) => { answers.push(await io.ask("cliente")); });
  render(<CommandConsole sessionId="w1" tabPrefix="prompt-test" active lines={[]} running={false}
    alert={null} notice={null} log={vi.fn()} onRun={onRun} onClear={vi.fn()} />);
  const prompt = screen.getByLabelText("Comando SQL");
  const submit = async (value: string) => {
    fireEvent.change(prompt, { target: { value } });
    await act(async () => { fireEvent.submit(prompt.closest("form")!); });
  };
  await submit("SELECT &cliente FROM DUAL;");
  expect(screen.getByText("Ingrese valor para cliente:")).toBeVisible();
  await submit("Ana");
  expect(answers).toEqual(["Ana"]);
  expect(onRun).toHaveBeenCalledTimes(1);
  await submit("SELECT &cliente FROM DUAL;");
  fireEvent.keyDown(prompt, { key: "Escape" });
  await waitFor(() => expect(answers).toEqual(["Ana", null]));
});

test("Ctrl+C copia una selección o cancela y Ctrl+L limpia la consola", () => {
  const onCancel = vi.fn();
  const onClear = vi.fn();
  render(<CommandConsole sessionId="w1" tabPrefix="keys-test" active lines={[]} running
    alert={null} notice={null} log={vi.fn()} onRun={vi.fn()} onCancel={onCancel} onClear={onClear} />);
  const prompt = screen.getByLabelText<HTMLTextAreaElement>("Comando SQL");
  fireEvent.change(prompt, { target: { value: "SELECT" } });
  prompt.focus();
  prompt.setSelectionRange(0, 6);
  expect(fireEvent.keyDown(prompt, { key: "a", ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(prompt, { key: "c", ctrlKey: true })).toBe(true);
  expect(onCancel).not.toHaveBeenCalled();
  prompt.setSelectionRange(0, 0);
  expect(fireEvent.keyDown(prompt, { key: "c", ctrlKey: true })).toBe(false);
  expect(onCancel).toHaveBeenCalledOnce();
  fireEvent.keyDown(prompt, { key: "l", ctrlKey: true });
  expect(onClear).toHaveBeenCalledOnce();
  fireEvent.keyDown(prompt, { key: "Escape" });
  expect(prompt).toHaveValue("");
  expect(fireEvent.keyDown(prompt, { key: "Escape" })).toBe(true);
});

test("exporta CSV con encabezado y todas las páginas del cursor", async () => {
  vi.spyOn(api, "sqlExecute").mockResolvedValue(query([["1", "Ana, B"]], true));
  const fetch = vi.spyOn(api, "sqlFetch").mockResolvedValue({ rows: [["2", "Beto"]], more: false });
  const save = vi.spyOn(api, "saveProgramFile").mockResolvedValue("resultados.csv");
  const { ref } = setup("SELECT 1 FROM DUAL;");
  await act(async () => ref.current!.execute!());
  await act(async () => ref.current!.exportData!());
  expect(fetch).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledWith('ID,NOMBRE\r\n1,"Ana, B"\r\n2,Beto', "csv", "resultados.csv");
});

test("abre con mas espacio para el editor y mueve el divisor en ambos sentidos", () => {
  setup("select 1 from dual");
  const divider = screen.getByRole("separator", { name: "Alto del editor" });
  expect(divider).toHaveAttribute("aria-valuenow", "70");
  fireEvent.keyDown(divider, { key: "ArrowUp" });
  expect(divider).toHaveAttribute("aria-valuenow", "66");
  fireEvent.keyDown(divider, { key: "ArrowDown" });
  expect(divider).toHaveAttribute("aria-valuenow", "70");
});

test("una prueba abre las variables tipadas debajo del editor y espera F8", async () => {
  const execute = vi.spyOn(api, "sqlExecute").mockResolvedValue(query([]));
  const source = 'BEGIN\n  "HR"."PKG"."RUN"("FECHA" => :FECHA);\nEND;\n/';
  const { ref } = setup(source, { testSettings: { bindKinds: { FECHA: "Date" }, outputs: [] } });
  const panel = within(screen.getByRole("tabpanel", { name: "Variables" }));
  expect(panel.getByRole("combobox", { name: "Tipo de :FECHA" })).toHaveValue("Date");
  expect(execute).not.toHaveBeenCalled();
  fireEvent.change(panel.getByRole("textbox", { name: "Valor de :FECHA" }), { target: { value: "2026-11-24" } });
  await act(async () => ref.current!.execute!());
  expect(execute).toHaveBeenCalledWith("w1", source.slice(0, -2), [
    { name: "FECHA", kind: "Date", value: "2026-11-24" },
  ]);
});

test("una salida registrada se envia como OUT y se muestra debajo del editor", async () => {
  const execute = vi.spyOn(api, "sqlExecute").mockResolvedValue({
    result: { kind: "Done", message: "Bloque ejecutado" },
    elapsed_ms: 1, output: [], transaction: false,
    test_outputs: [{ name: "SALIDA", kind: "Scalar", value: "42" }],
  });
  const outputs = [{ name: "SALIDA", label: "Retorno", kind: "Text" as const }];
  const { ref } = setup("BEGIN :SALIDA := 42; END;", { testSettings: { bindKinds: {}, outputs } });
  await act(async () => ref.current!.execute!());
  expect(execute).toHaveBeenCalledWith("w1", "BEGIN :SALIDA := 42; END;", [], undefined, outputs);
  expect(within(screen.getByRole("tabpanel", { name: "Variables" })).getByText("42")).toBeVisible();
});

test("muestra un cursor de salida en una grilla de solo lectura", async () => {
  vi.spyOn(api, "sqlExecute").mockResolvedValue({
    result: { kind: "Done", message: "Bloque ejecutado" },
    elapsed_ms: 1, output: [], transaction: false,
    test_outputs: [{ name: "FILAS", kind: "Cursor",
      columns: [{ name: "ID", type_name: "NUMBER", numeric: true, lob: false }],
      page: { rows: [["7"]], more: true },
    }],
  });
  const { ref } = setup("BEGIN :FILAS := NULL; END;", { testSettings: {
    bindKinds: {}, outputs: [{ name: "FILAS", label: "Filas", kind: "Cursor" }],
  } });
  await act(async () => ref.current!.execute!());
  const grid = within(screen.getByRole("region", { name: "Filas" })).getByRole("grid");
  expect(grid).toHaveAttribute("aria-readonly", "true");
  expect(within(grid).getByRole("gridcell", { name: "ID 7" })).toBeVisible();
  expect(screen.getByText("1 fila mostrada")).toBeVisible();
});

test("puede omitir una entrada con valor por defecto y guardar la prueba", async () => {
  const routine = { path: ["HR", "DEMO"], overloaded: false, signature: {
    subprogram_id: 1, returns: null, parameters: [
      { declaration: { name: "ID", data_type: "NUMBER", direction: "IN", defaulted: true } },
    ],
  } };
  const { ref, view } = setup("BEGIN\n  HR.DEMO(\n    ID => :ID\n  );\nEND;\n/", {
    testSettings: { routine, bindKinds: { ID: "Number" }, outputs: [] },
  });
  const save = vi.spyOn(api, "saveProgramFile").mockResolvedValue("demo.tst");
  fireEvent.click(screen.getByRole("checkbox", { name: "Usar ID" }));
  expect(view.state.doc.toString()).not.toContain(":ID");
  expect(screen.getByRole("checkbox", { name: "Usar ID" })).not.toBeChecked();
  await act(async () => ref.current!.save!());
  expect(save).toHaveBeenCalledWith('-- openpl-test v1\n-- {"bindKinds":{},"outputs":[]}\nBEGIN\n  HR.DEMO;\nEND;\n/', "tst", null);
});

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

test("muestra 50 filas alternadas y solo amplía al pulsar Traer todas junto a las pestañas", async () => {
  const first = Array.from({ length: 50 }, (_, i) => [String(i + 1), `Cliente ${i + 1}`]);
  const execute = vi.spyOn(api, "sqlExecute").mockResolvedValue(query(first, true, 7));
  const fetch = vi.spyOn(api, "sqlFetch")
    .mockResolvedValueOnce({ rows: [["51", "Beto"]], more: true })
    .mockResolvedValueOnce({ rows: [["52", "Caro"]], more: false });
  const { ref } = setup("select id, nombre from clientes");
  await act(async () => ref.current!.execute!());
  expect(screen.getByText("50 filas · 40 ms · hay más")).toBeInTheDocument();
  const region = within(screen.getByRole("region", { name: "Grilla de resultados" }));
  expect(region.getAllByRole("row")[1]).not.toHaveClass("sql-row-alt");
  expect(region.getAllByRole("row")[2]).toHaveClass("sql-row-alt");
  fireEvent.scroll(region.getByRole("grid").parentElement!);
  expect(fetch).not.toHaveBeenCalled();
  const bringAll = screen.getByRole("button", { name: /Traer todas/ });
  expect(screen.getByRole("tablist", { name: "Resultado" }).nextElementSibling).toBe(bringAll);
  fireEvent.click(bringAll);
  expect(region.getByRole("grid").parentElement).toHaveFocus();
  expect(await screen.findByText("Caro")).toBeInTheDocument();
  expect(fetch).toHaveBeenNthCalledWith(1, "w1", 7, 1000);
  expect(fetch).toHaveBeenNthCalledWith(2, "w1", 7, 1000);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(screen.getByText("52 filas · 40 ms")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Traer todas/ })).not.toBeInTheDocument();
});

test("indica la carga y conserva las filas si falla la continuación", async () => {
  vi.spyOn(api, "sqlExecute").mockResolvedValue(query([["1", "Ana"]], true, 7));
  let fail!: (error: unknown) => void;
  const fetch = vi.spyOn(api, "sqlFetch").mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const { ref } = setup("select id, nombre from clientes");
  await act(async () => ref.current!.execute!());
  const region = within(screen.getByRole("region", { name: "Grilla de resultados" }));
  const button = screen.getByRole("button", { name: /Traer todas/ });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(region.getByRole("status")).toHaveTextContent("Trayendo filas");
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => fail({ Db: { code: "ORA-03113", message: "fin de archivo en el canal" } }));
  expect(region.getByRole("alert")).toHaveTextContent("ORA-03113 fin de archivo en el canal · Reejecuta con F8");
  expect(region.getByText("Ana")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Traer todas/ })).not.toBeInTheDocument();
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
  expect(within(output).getByText("Línea 1, columna 15")).toBeInTheDocument();
  expect(view.state.selection.main.head).toBe(14);
  await waitFor(() => expect(view.dom.querySelector(".cm-lintRange-error")).not.toBeNull());
});

test("conserva DBMS_OUTPUT y la transacción de un bloque fallido", async () => {
  const exec = vi.spyOn(api, "sqlExecute").mockResolvedValueOnce({
    result: { kind: "Failed", error: { code: "ORA-20000", kind: "Other", message: "Error de prueba" } },
    elapsed_ms: 3, output: ["Antes del error"], transaction: true,
  });
  const { ref, onTransaction } = setup("begin null; end;\n/\nselect 1 from dual;");
  await act(async () => ref.current!.executeScript!());
  const output = within(screen.getByRole("tabpanel", { name: "Salida" }));
  expect(output.getByText("Antes del error")).toBeVisible();
  expect(output.getByText("ORA-20000: Error de prueba")).toBeVisible();
  expect(onTransaction).toHaveBeenLastCalledWith(true);
  expect(exec).toHaveBeenCalledTimes(1);
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
  fireEvent.click(screen.getByRole("button", { name: /^Detener/ }));
  expect(cancel).toHaveBeenCalledWith("w1");
  await act(async () => reject({ Db: { code: "ORA-01013", kind: "Other", message: "ORA-01013: user requested cancel" } }));
  expect(within(screen.getByRole("tabpanel", { name: "Salida" })).getByText("Ejecución cancelada")).toBeInTheDocument();
});

test("Detener muestra texto y atajo, y queda deshabilitado sin nada en curso", () => {
  const { ref } = setup("select 1 from dual");
  const stop = screen.getByRole("button", { name: /^Detener/ });
  expect(screen.getAllByRole("button", { name: /^Ejecutar/ })).toHaveLength(1);
  expect(stop).toHaveTextContent("Detener");
  expect(within(stop).getByText("Shift Esc")).toHaveClass("kbd");
  expect(stop).toBeDisabled();
  expect(ref.current!.cancel).toBeUndefined();
});

describe("Detener durante Traer todas", () => {
  async function startFetching() {
    const first = Array.from({ length: 50 }, (_, i) => [String(i + 1), `Cliente ${i + 1}`]);
    vi.spyOn(api, "sqlExecute").mockResolvedValue(query(first, true, 7));
    let fail!: (error: unknown) => void;
    let resolve!: (page: { rows: (string | null)[][]; more: boolean }) => void;
    const fetch = vi.spyOn(api, "sqlFetch")
      .mockResolvedValueOnce({ rows: [["51", "Beto"]], more: true })
      .mockReturnValueOnce(new Promise((ok, no) => { resolve = ok; fail = no; }));
    const cancel = vi.spyOn(api, "sqlCancel").mockResolvedValue(true);
    const { ref } = setup("select id, nombre from clientes");
    await act(async () => ref.current!.execute!());
    const region = within(screen.getByRole("region", { name: "Grilla de resultados" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Traer todas/ })));
    return { ref, region, fetch, cancel, fail: (e: unknown) => fail(e), resolve: (p: Parameters<typeof resolve>[0]) => resolve(p) };
  }

  test("corta la consulta en Oracle y conserva las filas recibidas", async () => {
    const { ref, region, cancel, fail } = await startFetching();
    const stop = screen.getByRole("button", { name: /^Detener/ });
    expect(stop).toBeEnabled();
    expect(ref.current!.cancel).toBeDefined();
    fireEvent.click(stop);
    expect(cancel).toHaveBeenCalledWith("w1");
    await act(async () => fail({ Db: { code: "ORA-01013", message: "ORA-01013: user requested cancel" } }));
    expect(screen.getByRole("status")).toHaveTextContent("Traer todas detenido. Se conservan 51 filas.");
    expect(region.queryByRole("alert")).not.toBeInTheDocument();
    expect(region.getByText("Beto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Traer todas/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Detener/ })).toBeDisabled();
  });

  test("si el corte llega entre páginas no pide la siguiente", async () => {
    const { ref, region, fetch, resolve } = await startFetching();
    act(() => ref.current!.cancel!());
    await act(async () => resolve({ rows: [["52", "Caro"]], more: true }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(region.getByText("Caro")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Traer todas detenido. Se conservan 52 filas.");
  });
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

describe("edición en grilla", () => {
  const target = {
    owner: "HR", name: "CLIENTES",
    columns: [
      { name: "ID", data_type: "NUMBER", nullable: false, editable: true },
      { name: "NOMBRE", data_type: "VARCHAR2", nullable: true, editable: true },
    ],
  };
  const editable = (rows: (string | null)[][]): ExecOutcome => ({
    result: {
      kind: "Query", cursor: 2,
      columns: [
        { name: ROWID_COLUMN, type_name: "ROWID", numeric: false, lob: false },
        { name: "ID", type_name: "NUMBER", numeric: true, lob: false },
        { name: "NOMBRE", type_name: "VARCHAR2(40)", numeric: false, lob: false },
      ],
      page: { rows, more: false },
    },
    elapsed_ms: 5, output: [], transaction: false,
  });

  async function startEditing(props: Partial<Parameters<typeof SqlWindow>[0]> = {}) {
    const exec = vi.spyOn(api, "sqlExecute")
      .mockResolvedValueOnce(query([["1", "Ana"], ["2", "Beto"]]))
      .mockResolvedValueOnce(editable([["AAA1", "1", "Ana"], ["AAA2", "2", "Beto"]]));
    const lookup = vi.spyOn(api, "sqlEditTarget").mockResolvedValue(target);
    const result = setup("select id, nombre from clientes", props);
    await act(async () => result.ref.current!.execute!());
    await act(async () => result.ref.current!.editData!());
    return { ...result, exec, lookup };
  }

  function editCell(row: number, column: string, value: string) {
    const grid = screen.getByRole("grid", { name: "Resultados" });
    const cell = within(grid).getAllByRole("gridcell", { name: new RegExp(`^${column} `) })[row];
    fireEvent.doubleClick(cell);
    const input = within(grid).getByRole("textbox", { name: `Editar ${column}` });
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  }

  test("Ctrl E agrega el ROWID oculto y Aplicar envía solo lo cambiado", async () => {
    const { exec, lookup, ref, onTransaction } = await startEditing();
    expect(lookup).toHaveBeenCalledWith("w1", null, "CLIENTES");
    expect(exec).toHaveBeenLastCalledWith("w1", `select clientes.ROWID AS "${ROWID_COLUMN}", id, nombre from clientes`, []);
    expect(screen.queryByRole("columnheader", { name: ROWID_COLUMN })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Editando/ })).toHaveAttribute("aria-pressed", "true");

    editCell(1, "NOMBRE", "Beatriz");
    expect(screen.getByText("1 pendiente")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "2, modificada" })).toBeInTheDocument();
    const apply = vi.spyOn(api, "sqlApply").mockResolvedValue({
      kind: "Applied", updated: 1, deleted: 0, inserted: [], transaction: true,
    });
    await act(async () => ref.current!.applyChanges!());
    expect(apply).toHaveBeenCalledWith("w1", target, [{
      kind: "Update", rowid: "AAA2",
      original: { ID: "2", NOMBRE: "Beto" }, values: { ID: "2", NOMBRE: "Beatriz" },
    }]);
    expect(screen.queryByText("1 pendiente")).not.toBeInTheDocument();
    expect(screen.getByText("Beatriz")).toBeInTheDocument();
    expect(onTransaction).toHaveBeenLastCalledWith(true);
  });

  test("agrega y borra filas, y Descartar vuelve al estado leído", async () => {
    const { ref } = await startEditing();
    const grid = within(screen.getByRole("grid", { name: "Resultados" }));
    fireEvent.click(grid.getAllByRole("gridcell", { name: /^ID / })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Borrar fila" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar fila" }));
    editCell(2, "ID", "3");
    expect(screen.getByText("2 pendientes")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "1, borrada" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "3, nueva" })).toBeInTheDocument();
    const apply = vi.spyOn(api, "sqlApply").mockResolvedValue({
      kind: "Applied", updated: 0, deleted: 1, inserted: ["AAA3"], transaction: true,
    });
    await act(async () => ref.current!.applyChanges!());
    expect(apply.mock.calls[0][2]).toEqual([
      { kind: "Delete", rowid: "AAA1", original: { ID: "1", NOMBRE: "Ana" } },
      { kind: "Insert", values: { ID: "3", NOMBRE: null } },
    ]);
    expect(screen.queryByText("Ana")).not.toBeInTheDocument();

    editCell(0, "NOMBRE", "Otro");
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.queryByText("1 pendiente")).not.toBeInTheDocument();
    expect(screen.getByText("Beto")).toBeInTheDocument();
  });

  test("borrar la selección completa prepara cambios sin aplicarlos", async () => {
    await startEditing();
    const apply = vi.spyOn(api, "sqlApply");
    fireEvent.click(screen.getByRole("button", { name: "Agregar fila" }));
    fireEvent.click(screen.getByRole("button", { name: "Seleccionar filas cargadas" }));
    expect(screen.getAllByRole("gridcell", { selected: true })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Borrar selección" }));
    expect(screen.getByRole("rowheader", { name: "1, borrada" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "2, borrada" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "3, nueva" })).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });

  test("un conflicto no aplica nada y permite reintentar con los valores actuales", async () => {
    const { ref } = await startEditing();
    editCell(0, "NOMBRE", "Anabel");
    const apply = vi.spyOn(api, "sqlApply")
      .mockResolvedValueOnce({ kind: "Conflicts", conflicts: [{ index: 0, reason: "Changed", current: { ID: "1", NOMBRE: "Ana María" } }] })
      .mockResolvedValueOnce({ kind: "Applied", updated: 1, deleted: 0, inserted: [], transaction: true });
    await act(async () => ref.current!.applyChanges!());
    const conflicts = within(screen.getByRole("region", { name: "Conflictos" }));
    expect(conflicts.getByText(/Fila 1: cambió en Oracle/)).toBeInTheDocument();
    expect(conflicts.getByText(/NOMBRE: «Ana María»/)).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "1, en conflicto" })).toBeInTheDocument();
    await act(async () => fireEvent.click(conflicts.getByRole("button", { name: "Reintentar con valores actuales" })));
    expect(apply).toHaveBeenLastCalledWith("w1", target, [{
      kind: "Update", rowid: "AAA1", original: { ID: "1", NOMBRE: "Ana María" }, values: { ID: "1", NOMBRE: "Anabel" },
    }]);
    expect(screen.queryByRole("region", { name: "Conflictos" })).not.toBeInTheDocument();
  });

  test("una consulta con join no se puede editar", async () => {
    vi.spyOn(api, "sqlExecute").mockResolvedValue(query([["1", "Ana"]]));
    const lookup = vi.spyOn(api, "sqlEditTarget");
    const { ref } = setup("select a.id, b.nombre from a join b on a.id = b.id");
    await act(async () => ref.current!.execute!());
    await act(async () => ref.current!.editData!());
    expect(lookup).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Solo se edita una consulta sobre una tabla");
  });

  test("en producción la edición lo avisa", async () => {
    await startEditing({ environment: "prod" });
    expect(screen.getByRole("note")).toHaveTextContent("Editando datos de producción");
  });
});
