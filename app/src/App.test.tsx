import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import App from "./App";
import { api } from "./api";

beforeAll(async () => {
  // La latencia de los módulos del runner no forma parte del flujo de sesión.
  await Promise.all([
    import("./components/ProgramWindow"),
    import("./components/SqlWindow"),
  ]);
});

test("Ctrl K busca y ejecuta una acción disponible", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.openProgramFile).mockResolvedValue(null);
  vi.mocked(api.openProgramFile).mockClear();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const search = screen.getByRole("textbox", { name: "Buscar comando" });
  fireEvent.change(search, { target: { value: "ctrl o" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(api.openProgramFile).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "Buscar comando" })).not.toBeInTheDocument();
});

const windowEvents = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: windowEvents.close }),
}));

vi.mock("./api", () => ({
  api: {
    clientInfo: vi.fn(async () => ({
      version: "19.0.0",
      error: null,
      help: "",
      lib_dir: null,
    })),
    openProgramFile: vi.fn(),
    saveProgramFile: vi.fn(),
    listProfiles: vi.fn(async () => []),
    connect: vi.fn(),
    listObjects: vi.fn(),
    programSource: vi.fn(),
    routineOverloads: vi.fn(),
    sqlOpen: vi.fn(),
    sqlClose: vi.fn(),
    sqlExecute: vi.fn(),
    sqlCommit: vi.fn(),
    sqlRollback: vi.fn(),
    sqlCancel: vi.fn(),
    sqlEditTarget: vi.fn(),
    sqlApply: vi.fn(),
  },
}));

test("permite editar y guardar un archivo local desde el flujo normal", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.openProgramFile).mockResolvedValue({
    name: "demo.pks",
    source: "PACKAGE demo AS\r\nEND;",
  });
  vi.mocked(api.saveProgramFile)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("demo.pks");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    const editor = await screen.findByRole("textbox", { name: "Spec" });
    const view = EditorView.findFromDOM(
      editor.closest<HTMLElement>(".cm-editor")!,
    )!;
    act(() =>
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "\n-- cambio" },
      }),
    );
    await screen.findByRole("button", { name: /demo\.pks \*/ });

    const closeEvent = { preventDefault: vi.fn() };
    const onClose = windowEvents.close.mock.calls[0]?.[0];
    expect(onClose).toBeTypeOf("function");
    onClose(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar demo.pks" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(editor).toBeInTheDocument();

    const program = within(
      screen.getByRole("region", { name: "Ventana de programa" }),
    );
    expect(
      program.queryByRole("button", { name: /Guardar/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await vi.waitFor(() =>
      expect(api.saveProgramFile).toHaveBeenCalledTimes(1),
    );
    await screen.findByRole("button", { name: /demo\.pks \*/ });
    fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Archivo" })).getByRole(
        "menuitem",
        { name: /^Guardar/ },
      ),
    );
    await program.findByText("Archivo guardado");
    expect(api.saveProgramFile).toHaveBeenLastCalledWith(
      "PACKAGE demo AS\nEND;\n-- cambio",
      "sql",
      "demo.pks",
    );
    await screen.findByRole("button", { name: /^demo\.pks$/ });
    await act(async () => { fireEvent.keyDown(window, { key: "w", ctrlKey: true }); });
    await vi.waitFor(() => expect(editor).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally {
    confirm.mockRestore();
  }
});

test("compara el programa en su sesión aunque el explorador cambie de conexión", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.connect)
    .mockResolvedValueOnce({
      session_id: "s1",
      server_version: "12.1.0",
      compat: { kind: "Supported" },
    })
    .mockResolvedValueOnce({
      session_id: "s2",
      server_version: "12.1.0",
      compat: { kind: "Supported" },
    });
  vi.mocked(api.listObjects).mockResolvedValue([
    {
      owner: "HR",
      name: "PKG_A",
      object_type: "Package",
      status: "Valid",
      last_ddl_time: "2026-01-01T12:00:00",
    },
  ]);
  const spec = {
    kind: "PACKAGE",
    source: "CREATE OR REPLACE PACKAGE PKG_A AS\n  g_total NUMBER;\nEND;",
    last_ddl_time: "2026-01-01T12:00:00",
    diagnostics: [],
  };
  vi.mocked(api.programSource)
    .mockResolvedValueOnce([spec])
    .mockResolvedValueOnce([
      { ...spec, source: "CREATE OR REPLACE PACKAGE PKG_A AS\nEND; -- remoto" },
    ])
    .mockResolvedValueOnce([spec]);
  render(<App />);

  async function login(service: string) {
    const dialog = within(
      await screen.findByRole("dialog", { name: "Conectar a Oracle" }),
    );
    const user = dialog.getByLabelText("Usuario");
    fireEvent.change(user, { target: { value: "HR" } });
    fireEvent.change(dialog.getByLabelText("Contraseña"), {
      target: { value: "clave" },
    });
    fireEvent.change(dialog.getByLabelText("Host"), {
      target: { value: "db.example.com" },
    });
    fireEvent.change(dialog.getByLabelText("Servicio"), {
      target: { value: service },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(user).not.toBeInTheDocument());
  }

  await login("DEV");
  fireEvent.click(await screen.findByRole("treeitem", { name: "Paquetes" }));
  const object = await screen.findByRole("treeitem", { name: "PKG_A" });
  fireEvent.contextMenu(object);
  fireEvent.click(screen.getByRole("menuitem", { name: "Editar Spec y Body" }));
  const editor = await screen.findByRole("textbox", { name: "Spec" });
  fireEvent.keyDown(window, { key: "P", altKey: true, shiftKey: true });
  expect(editor.querySelector(".cm-foldPlaceholder")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "A", altKey: true, shiftKey: true });
  expect(editor.querySelector(".cm-foldPlaceholder")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "l", ctrlKey: true, shiftKey: true });
  await login("QA");
  await act(async () => {
    fireEvent.keyDown(window, { key: "d", altKey: true, shiftKey: true });
  });

  expect(await screen.findByText("Cambio en Oracle")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar comparación" }));
  expect(
    screen.queryByRole("region", { name: /^Comparación/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sesión" }));
  const session = within(screen.getByRole("menu", { name: "Sesión" }));
  expect(
    session.queryByRole("menuitem", { name: /Preparar compilación/ }),
  ).not.toBeInTheDocument();
  expect(session.getByRole("menuitem", { name: /^Ejecutar(?! script)/ })).toBeEnabled();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.keyDown(window, { key: "d", altKey: true, shiftKey: true });
  expect(await screen.findByText("Sin diferencias de texto")).toBeInTheDocument();
  expect(api.programSource).toHaveBeenCalledTimes(3);
  expect(api.programSource).toHaveBeenLastCalledWith(
    "s1",
    "Package",
    "HR",
    "PKG_A",
  );
});

test("Nuevo despliega los tipos de ventana y crea un paquete con Spec y Body", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  const menu = within(screen.getByRole("menu", { name: "Nuevo" }));
  expect(menu.getByRole("menuitem", { name: /Ventana SQL/ })).toBeDisabled();
  expect(
    menu.getByRole("menuitem", { name: /Ventana de prueba/ }),
  ).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Vista/ })).toBeEnabled();
  fireEvent.click(menu.getByRole("menuitem", { name: /Paquete/ }));
  expect(
    await screen.findByRole("textbox", { name: "Spec" }),
  ).toHaveTextContent("CREATE OR REPLACE PACKAGE nuevo_paquete AS");
  fireEvent.click(screen.getByRole("tab", { name: /^Body/ }));
  expect(screen.getByRole("textbox", { name: "Body" })).toHaveTextContent(
    "CREATE OR REPLACE PACKAGE BODY nuevo_paquete AS",
  );
  expect(screen.queryByRole("menu", { name: "Nuevo" })).not.toBeInTheDocument();
});

test("bloquea el menú del navegador salvo en campos de texto", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  const input = (await screen.findAllByRole("textbox"))[0];
  expect(fireEvent.contextMenu(input)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(fireEvent.contextMenu(document.querySelector(".titlebar")!)).toBe(
    false,
  );
});

test("sin conexión ofrece conectar o abrir un programa, y lo pendiente se marca", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  const workspace = within(screen.getByRole("main"));
  expect(workspace.getByText("Sin conexión")).toBeInTheDocument();
  fireEvent.click(workspace.getByRole("button", { name: /Nuevo programa/ }));
  expect(
    await screen.findByRole("textbox", { name: "Fuente" }),
  ).toBeInTheDocument();

  expect(
    screen.queryByRole("button", { name: "Ayuda" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Commit/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  const menu = within(screen.getByRole("menu", { name: "Nuevo" }));
  expect(
    menu.getByRole("menuitem", { name: /Ventana de prueba/ }),
  ).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Ventana de comando/ })).toBeDisabled();
  expect(menu.getByRole("menuitem", { name: /Ventana SQL/ })).toBeDisabled();
  expect(
    menu.getByRole("menuitem", { name: /Ventana SQL/ }),
  ).not.toHaveTextContent("Próximamente");
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Sesión" }));
  const session = within(screen.getByRole("menu", { name: "Sesión" }));
  expect(
    session.getByRole("menuitem", { name: /Plan de ejecución/ }),
  ).toBeDisabled();
  expect(
    session.getByRole("menuitem", { name: /^Desconectar$/ }),
  ).toBeDisabled();
});

test("Conectar desde el área vacía abre el login", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", { name: /Conectar/ }),
  );
  expect(
    await screen.findByRole("button", { name: "Cancelar" }),
  ).toBeInTheDocument();
});

async function connectAs(service = "DEV") {
  vi.mocked(api.connect).mockResolvedValueOnce({
    session_id: "s1",
    server_version: "12.1.0",
    compat: { kind: "Supported" },
  });
  const dialog = within(
    await screen.findByRole("dialog", { name: "Conectar a Oracle" }),
  );
  const user = dialog.getByLabelText("Usuario");
  fireEvent.change(user, { target: { value: "HR" } });
  fireEvent.change(dialog.getByLabelText("Contraseña"), {
    target: { value: "clave" },
  });
  fireEvent.change(dialog.getByLabelText("Host"), {
    target: { value: "db.example.com" },
  });
  fireEvent.change(dialog.getByLabelText("Servicio"), {
    target: { value: service },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Conectar" }));
  await waitFor(() => expect(user).not.toBeInTheDocument());
}

test("abre una prueba desde Nuevo y reabre un .tst sin ejecutarlo", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  const block = "BEGIN :SALIDA := 42; END;";
  vi.mocked(api.openProgramFile).mockResolvedValueOnce({
    name: "demo.tst",
    source: `-- openpl-test v1\n-- {"bindKinds":{},"outputs":[{"name":"SALIDA","label":"Retorno","kind":"Text"}]}\n${block}`,
  });
  vi.mocked(api.sqlExecute).mockClear();

  render(<App />);
  await connectAs();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: /Ventana de prueba/ }));
  });
  expect(await screen.findByRole("button", { name: "Prueba 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar Prueba 1" }));
  await act(async () => { fireEvent.keyDown(window, { key: "o", ctrlKey: true }); });
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  expect(editor).toHaveTextContent(block);
  expect(screen.getByRole("button", { name: "demo.tst" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Retorno" })).toBeInTheDocument();
  expect(api.sqlExecute).not.toHaveBeenCalled();
});

test("Probar desde el explorador carga la firma en su sesion y abre una prueba", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([{
    owner: "HR", name: "DEMO", object_type: "Procedure", status: "Valid", last_ddl_time: "",
  }]);
  vi.mocked(api.routineOverloads).mockResolvedValue([{ subprogram_id: 1, parameters: [], returns: null }]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.sqlExecute).mockClear();
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Procedimientos" }));
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "DEMO" }));
  await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "Probar" })); });
  expect(await screen.findByRole("button", { name: "Prueba 1" })).toBeInTheDocument();
  expect(api.routineOverloads).toHaveBeenLastCalledWith("s1", "HR", null, "DEMO");
  expect(api.sqlExecute).not.toHaveBeenCalled();
});

test("Ctrl N abre una ventana SQL con sesión propia y Commit actúa sobre ella", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.sqlExecute).mockResolvedValue({
    result: { kind: "Done", message: "1 fila actualizada" },
    elapsed_ms: 1,
    output: [],
    transaction: true,
  });
  vi.mocked(api.sqlCommit).mockResolvedValue(false);
  render(<App />);
  await connectAs();
  expect(screen.getByText("Sin transacción")).toBeInTheDocument();
  await act(async () => {
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  });
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  expect(api.sqlOpen).toHaveBeenCalledWith("s1");
  const view = EditorView.findFromDOM(
    editor.closest<HTMLElement>(".cm-editor")!,
  )!;
  act(() =>
    view.dispatch({ changes: { from: 0, insert: "update t set a = 1" } }),
  );
  await act(async () => {
    fireEvent.keyDown(window, { key: "F8" });
  });
  expect(api.sqlExecute).toHaveBeenCalledWith("w1", "update t set a = 1", []);
  expect(await screen.findByText("Transacción abierta")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Commit/ }));
  expect(await screen.findByText("Sin transacción")).toBeInTheDocument();
  expect(api.sqlCommit).toHaveBeenCalledWith("w1");
});

test("cerrar una ventana SQL con transacción abierta pregunta qué hacer", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w2");
  vi.mocked(api.sqlExecute).mockResolvedValue({
    result: { kind: "Done", message: "1 fila borrada" },
    elapsed_ms: 1,
    output: [],
    transaction: true,
  });
  vi.mocked(api.sqlRollback).mockResolvedValue(false);
  vi.mocked(api.sqlClose).mockResolvedValue();
  render(<App />);
  await connectAs();
  await act(async () => {
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  });
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  const view = EditorView.findFromDOM(
    editor.closest<HTMLElement>(".cm-editor")!,
  )!;
  act(() =>
    view.dispatch({
      changes: { from: 0, insert: "delete from t where id = 1" },
    }),
  );
  await act(async () => {
    fireEvent.keyDown(window, { key: "F8" });
  });
  await screen.findByText("Transacción abierta");

  fireEvent.click(screen.getByRole("button", { name: /^Cerrar SQL 1/ }));
  let dialog = within(
    screen.getByRole("dialog", { name: "Transacción abierta" }),
  );
  fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
  expect(editor).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Cerrar SQL 1/ }));
  dialog = within(screen.getByRole("dialog", { name: "Transacción abierta" }));
  fireEvent.click(dialog.getByRole("button", { name: "Rollback" }));
  await waitFor(() => expect(editor).not.toBeInTheDocument());
  expect(api.sqlRollback).toHaveBeenCalledWith("w2");
  expect(api.sqlClose).toHaveBeenCalledWith("w2");
});

test("Consultar datos del explorador abre y ejecuta un SELECT", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([
    {
      owner: "HR",
      name: "CLIENTES",
      object_type: "Table",
      status: "Valid",
      last_ddl_time: "",
    },
  ]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w3");
  vi.mocked(api.sqlExecute).mockResolvedValue({
    result: {
      kind: "Query",
      cursor: 1,
      columns: [{ name: "ID", type_name: "NUMBER", numeric: true }],
      page: { rows: [["1"]], more: false },
    },
    elapsed_ms: 1,
    output: [],
    transaction: false,
  });
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Tablas" }));
  fireEvent.contextMenu(
    await screen.findByRole("treeitem", { name: "CLIENTES" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: /Consultar datos/ }));
  expect(
    await screen.findByRole("grid", { name: "Resultados" }),
  ).toBeInTheDocument();
  expect(api.sqlExecute).toHaveBeenCalledWith(
    "w3",
    'SELECT t.* FROM "HR"."CLIENTES" t',
    [],
  );
});

test("Editar datos del explorador abre la grilla en edición", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([
    {
      owner: "HR",
      name: "CLIENTES",
      object_type: "Table",
      status: "Valid",
      last_ddl_time: "",
    },
  ]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w4");
  vi.mocked(api.sqlEditTarget).mockResolvedValue({
    owner: "HR",
    name: "CLIENTES",
    columns: [
      { name: "ID", data_type: "NUMBER", nullable: false, editable: true },
    ],
  });
  vi.mocked(api.sqlExecute)
    .mockResolvedValueOnce({
      result: {
        kind: "Query",
        cursor: 1,
        columns: [{ name: "ID", type_name: "NUMBER", numeric: true }],
        page: { rows: [["1"]], more: false },
      },
      elapsed_ms: 1,
      output: [],
      transaction: false,
    })
    .mockResolvedValueOnce({
      result: {
        kind: "Query",
        cursor: 2,
        columns: [
          { name: "OPENPL$ROWID", type_name: "ROWID", numeric: false },
          { name: "ID", type_name: "NUMBER", numeric: true },
        ],
        page: { rows: [["AAA1", "1"]], more: false },
      },
      elapsed_ms: 1,
      output: [],
      transaction: false,
    });
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Tablas" }));
  fireEvent.contextMenu(
    await screen.findByRole("treeitem", { name: "CLIENTES" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: /Editar datos/ }));
  expect(
    await screen.findByRole("button", { name: /Editando/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(api.sqlEditTarget).toHaveBeenCalledWith("w4", "HR", "CLIENTES");
  expect(api.sqlExecute).toHaveBeenCalledWith(
    "w4",
    'SELECT t.ROWID AS "OPENPL$ROWID", t.* FROM "HR"."CLIENTES" t',
    [],
  );
});

test("F8 compila el programa en una sesión hermana y Detener la cancela", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  for (const mock of [api.sqlOpen, api.sqlExecute, api.sqlClose, api.sqlCancel, api.programSource]) {
    vi.mocked(mock).mockReset();
  }
  vi.mocked(api.listObjects).mockResolvedValue([
    {
      owner: "HR",
      name: "PKG_A",
      object_type: "Package",
      status: "Valid",
      last_ddl_time: "2026-01-01T12:00:00",
    },
  ]);
  const spec = {
    kind: "PACKAGE",
    source: "CREATE OR REPLACE PACKAGE PKG_A AS\n  g_total NUMBER;\nEND;",
    last_ddl_time: "2026-01-01T12:00:00",
    diagnostics: [],
  };
  vi.mocked(api.programSource)
    .mockResolvedValueOnce([spec])
    .mockResolvedValueOnce([spec])
    .mockResolvedValueOnce([{ ...spec, last_ddl_time: "2026-01-01T12:05:00" }]);
  vi.mocked(api.sqlOpen).mockResolvedValue("c1");
  vi.mocked(api.sqlClose).mockResolvedValue();
  vi.mocked(api.sqlCancel).mockResolvedValue(true);
  let finish: () => void = () => {};
  vi.mocked(api.sqlExecute).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            result: { kind: "Done", message: "Paquete creado" },
            elapsed_ms: 1,
            output: [],
            transaction: false,
          });
      }),
  );
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Paquetes" }));
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "PKG_A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Editar Spec y Body" }));
  await screen.findByRole("textbox", { name: "Spec" });

  const f8 = new KeyboardEvent("keydown", { key: "F8", cancelable: true });
  act(() => {
    window.dispatchEvent(f8);
  });
  expect(f8.defaultPrevented).toBe(true);
  await waitFor(() => expect(api.sqlExecute).toHaveBeenCalledTimes(1));
  expect(api.sqlOpen).toHaveBeenCalledWith("s1");
  const [sid, sql, binds] = vi.mocked(api.sqlExecute).mock.calls[0];
  expect(sid).toBe("c1");
  expect(sql).toBe('CREATE OR REPLACE PACKAGE "HR"."PKG_A" AS\n  g_total NUMBER;\nEND;');
  expect(sql).not.toMatch(/^\s*\/\s*$/m);
  expect(binds).toEqual([]);

  const stop = screen.getByRole("button", { name: /^Detener/ });
  await waitFor(() => expect(stop).toBeEnabled());
  fireEvent.keyDown(window, { key: "Escape", shiftKey: true });
  expect(api.sqlCancel).toHaveBeenCalledWith("c1");
  fireEvent.click(stop);
  expect(api.sqlCancel).toHaveBeenCalledTimes(2);

  await act(async () => finish());
  expect(await screen.findByText("Compilado")).toBeInTheDocument();
  expect(api.sqlClose).toHaveBeenCalledWith("c1");
  const order = (mock: unknown) =>
    vi.mocked(mock as typeof api.sqlOpen).mock.invocationCallOrder[0];
  expect(order(api.sqlOpen)).toBeLessThan(order(api.sqlExecute));
  expect(order(api.sqlExecute)).toBeLessThan(order(api.sqlClose));
  expect(api.sqlExecute).not.toHaveBeenCalledWith("s1", expect.anything(), expect.anything());
});

test("Ver > Personalizar interfaz y Ctrl , abren el diálogo de temas", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Ver" }));
  fireEvent.click(
    within(screen.getByRole("menu", { name: "Ver" })).getByRole("menuitem", {
      name: /Personalizar interfaz/,
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Personalizar interfaz" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog", { name: "Personalizar interfaz" })).toBeNull();
  fireEvent.keyDown(window, { key: ",", ctrlKey: true });
  expect(screen.getByRole("dialog", { name: "Personalizar interfaz" })).toBeInTheDocument();
});

test("el botón Sol/Luna alterna entre tema oscuro y claro", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  localStorage.clear();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Tema claro" }));
  expect(document.documentElement.dataset.theme).toBe("papel");
  fireEvent.click(screen.getByRole("button", { name: "Tema oscuro" }));
  expect(document.documentElement.dataset.theme).toBe("grafito");
  localStorage.clear();
});
