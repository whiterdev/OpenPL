import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";
import { Profiler } from "react";
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

test("soltar un archivo abre su contenido y soltar texto conserva el comportamiento nativo", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  expect(fireEvent.drop(window, { dataTransfer: { types: ["text/plain"], files: [] } })).toBe(true);
  expect(fireEvent.drop(window, {
    dataTransfer: { types: ["Files"], files: [{ name: "demo.sql", text: async () => "select 1 from dual" }] },
  })).toBe(false);
  expect(await screen.findByRole("button", { name: "demo.sql" })).toBeVisible();
  fireEvent.drop(window, {
    dataTransfer: { types: ["Files"], files: [{ name: "demo.zip", text: async () => "" }] },
  });
  expect(await screen.findByText("Tipo no admitido: demo.zip")).toBeVisible();
});

test("Ctrl Tab cambia de pestaña y Ctrl Shift RePág la reordena", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [
    { name: "uno.sql", text: async () => "select 1 from dual" },
    { name: "dos.sql", text: async () => "select 2 from dual" },
  ] } });
  const two = await screen.findByRole("button", { name: "dos.sql" });
  const one = screen.getByRole("button", { name: "uno.sql" });
  expect(two).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
  expect(one).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
  expect(two).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(window, { key: "PageUp", ctrlKey: true, shiftKey: true });
  expect(screen.getAllByRole("button", { name: /^(dos|uno)\.sql$/ })).toEqual([two, one]);
});

const windowEvents = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: windowEvents.close }),
}));

const updater = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("./updater", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./updater")>()),
  tauriUpdater: updater,
}));
beforeEach(() => {
  updater.check.mockReset();
  updater.check.mockResolvedValue(null);
});

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
    loadWorkspace: vi.fn(),
    saveWorkspace: vi.fn(async () => {}),
    clearWorkspace: vi.fn(async () => {}),
    connect: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    sessionSiblings: vi.fn(async (): Promise<string[]> => []),
    sessionPing: vi.fn(async () => true),
    listObjects: vi.fn(),
    programSource: vi.fn(),
    editorObject: vi.fn(async () => null),
    describeColumns: vi.fn(async () => []),
    routineOverloads: vi.fn(),
    completeObjects: vi.fn(),
    objectColumns: vi.fn(),
    sqlOpen: vi.fn(),
    sqlClose: vi.fn(async () => {}),
    sqlExecute: vi.fn(),
    sqlFetch: vi.fn(),
    sqlCommit: vi.fn(),
    sqlRollback: vi.fn(),
    sqlCancel: vi.fn(),
    sqlEditTarget: vi.fn(),
    sqlApply: vi.fn(),
  },
}));

test("tipear en un programa ya modificado no vuelve a renderizar la app", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.openProgramFile).mockResolvedValue({
    name: "demo.pks",
    source: "PACKAGE demo AS\nEND;",
  });
  let commits = 0;
  render(
    <Profiler id="app" onRender={() => { commits += 1; }}>
      <App />
    </Profiler>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  const editor = await screen.findByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" }, userEvent: "input.type" }));
  await screen.findByRole("button", { name: /demo\.pks \*/ });

  commits = 0;
  for (const insert of ["-", "-", " ", "x"]) {
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert }, userEvent: "input.type" }));
  }
  expect(commits).toBe(0);
});

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
    const copy = new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(false);
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

function press(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

async function openNewProgram() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", { name: /Nuevo programa/ }),
  );
  const editor = await screen.findByRole("textbox", { name: "Fuente" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  return { editor, view };
}

test("Ctrl A en el editor llega a CodeMirror y selecciona todo", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  const { editor, view } = await openNewProgram();
  act(() => view.dispatch({ changes: { from: 0, insert: "SELECT 1\nFROM dual" } }));
  press(editor, { key: "a", ctrlKey: true });
  expect(view.state.doc.length).toBeGreaterThan(0);
  expect(view.state.selection.main.from).toBe(0);
  expect(view.state.selection.main.to).toBe(view.state.doc.length);
});

test("en un campo de texto las teclas de edición y selección son las nativas", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  render(<App />);
  await connectAs();
  await act(async () => {
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  });
  await screen.findByRole("textbox", { name: "SQL" });
  const filter = screen.getByRole("textbox", { name: "Filtrar objetos" });
  const native: KeyboardEventInit[] = [
    { key: "a", ctrlKey: true },
    { key: "z", ctrlKey: true },
    { key: "y", ctrlKey: true },
    { key: "Z", ctrlKey: true, shiftKey: true },
    { key: "End", ctrlKey: true, shiftKey: true },
  ];
  for (const init of native) {
    expect(press(filter, init), JSON.stringify(init)).toBe(false);
  }
});

test("las teclas del webview se bloquean con y sin diálogo abierto", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  const user = await screen.findByLabelText("Usuario");
  expect(press(user, { key: "a", ctrlKey: true })).toBe(false);
  const webview: KeyboardEventInit[] = [
    { key: "r", ctrlKey: true },
    { key: "R", ctrlKey: true, shiftKey: true },
    { key: "F5" },
    { key: "p", ctrlKey: true },
    { key: "u", ctrlKey: true },
    { key: "I", ctrlKey: true, shiftKey: true },
    { key: "F12" },
  ];
  for (const init of webview) {
    expect(press(user, init), `diálogo ${JSON.stringify(init)}`).toBe(true);
  }
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  for (const init of webview) {
    expect(press(document.body, init), JSON.stringify(init)).toBe(true);
  }
});

test("Ctrl rueda no hace zoom", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  await screen.findByRole("button", { name: "Cancelar" });
  expect(fireEvent.wheel(document.body, { ctrlKey: true, deltaY: -100 })).toBe(false);
  expect(fireEvent.wheel(document.body, { deltaY: -100 })).toBe(true);
});

test("los botones laterales del mouse no navegan", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  await screen.findByRole("button", { name: "Cancelar" });
  for (const button of [3, 4]) {
    expect(fireEvent.mouseUp(document.body, { button }), `mouseup ${button}`).toBe(false);
    const aux = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button });
    expect(fireEvent(document.body, aux), `auxclick ${button}`).toBe(false);
  }
  expect(fireEvent.mouseUp(document.body, { button: 0 })).toBe(true);
});

test("dentro del editor el menú contextual lo decide el editor", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  const { editor } = await openNewProgram();
  expect(fireEvent.contextMenu(editor.closest(".cm-editor")!)).toBe(true);
  expect(fireEvent.contextMenu(document.querySelector(".titlebar")!)).toBe(false);
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

  fireEvent.click(screen.getByRole("button", { name: "Ayuda" }));
  expect(
    within(screen.getByRole("menu", { name: "Ayuda" })).getByRole("menuitem", { name: "Buscar actualizaciones" }),
  ).toBeEnabled();
  fireEvent.keyDown(document, { key: "Escape" });
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

test("reconectar un perfil ofrece restaurar SQL sin ejecutarlo", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listProfiles).mockResolvedValueOnce([{
    id: "11111111-1111-1111-1111-111111111111", name: "HR en DEV", user: "HR",
    db: "db.example.com:1521/DEV", role: "Normal", environment: "dev", save_password: false,
  }]);
  vi.mocked(api.loadWorkspace).mockResolvedValueOnce({ version: 1, tabs: [
    { type: "sql", kind: "sql", title: "Consulta guardada", text: "SELECT 1 FROM DUAL" },
  ] });
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.connect).mockResolvedValueOnce({ session_id: "s1", server_version: "12.1.0", compat: { kind: "Supported" } });
  vi.mocked(api.sqlExecute).mockClear();
  render(<App />);
  const login = within(await screen.findByRole("dialog", { name: "Conectar a Oracle" }));
  fireEvent.click(await login.findByRole("button", { name: /^HR en DEV/ }));
  fireEvent.click(login.getByRole("button", { name: "Conectar" }));
  expect(await screen.findByText("Restaurar 1 pestaña")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));
  expect(await screen.findByRole("textbox", { name: "SQL" })).toHaveTextContent("SELECT 1 FROM DUAL");
  expect(api.loadWorkspace).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  expect(api.sqlExecute).not.toHaveBeenCalled();
});

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

test("WAL-116: en una ventana SQL nueva, pegar y Ejecutar corre lo pegado", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.sqlExecute).mockReset().mockResolvedValue({
    result: { kind: "Done", message: "Ejecutado" },
    elapsed_ms: 1,
    output: [],
    transaction: false,
  });
  render(<App />);
  await connectAs();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ventana SQL/ }));
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  const pasted = "select 1 from dual;\n";
  act(() => view.dispatch({
    changes: { from: 0, insert: pasted },
    selection: { anchor: pasted.length },
    userEvent: "input.paste",
  }));
  const sql = within(screen.getByRole("region", { name: "Ventana SQL" }));
  await act(async () => {
    fireEvent.click(sql.getByRole("button", { name: /^Ejecutar/ }));
  });
  expect(api.sqlExecute).toHaveBeenCalledWith("w1", "select 1 from dual", []);
});

test("la ventana SQL completa las columnas de un alias con su propia sesión", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.objectColumns).mockResolvedValue([
    { name: "NRO_DOCUMENTO", data_type: "NUMBER", nullable: false },
  ]);
  render(<App />);
  await connectAs();
  await act(async () => {
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  });
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  const text = "SELECT * FROM FIN_DOCUMENTO T WHERE T.";
  act(() => view.dispatch({ changes: { from: 0, insert: text }, selection: { anchor: text.length } }));
  act(() => { startCompletion(view); });
  expect(await screen.findByRole("option", { name: /NRO_DOCUMENTO/ })).toBeInTheDocument();
  expect(api.objectColumns).toHaveBeenCalledWith("w1", null, "FIN_DOCUMENTO", null);
});

async function openSqlWithResults() {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w5");
  vi.mocked(api.sqlExecute).mockReset().mockResolvedValue({
    result: {
      kind: "Query",
      cursor: 7,
      columns: [{ name: "ID", type_name: "NUMBER", numeric: true, lob: false }],
      page: { rows: [["1"]], more: true },
    },
    elapsed_ms: 1,
    output: [],
    transaction: false,
  });
  vi.mocked(api.sqlFetch).mockReset().mockResolvedValue({ rows: [["2"]], more: false });
  render(<App />);
  await connectAs();
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ventana SQL/ }));
  const editor = await screen.findByRole("textbox", { name: "SQL" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "SELECT id\nFROM t" } }));
  view.focus();
  await act(async () => {
    press(editor, { key: "F8" });
  });
  const grid = await screen.findByRole("grid", { name: "Resultados" });
  return { editor, view, grid };
}

test("Ctrl Shift End en el editor selecciona hasta el final y no trae todas", async () => {
  const { editor, view } = await openSqlWithResults();
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  act(() => {
    press(editor, { key: "End", ctrlKey: true, shiftKey: true });
  });
  expect(view.state.selection.main.anchor).toBe(0);
  expect(view.state.selection.main.head).toBe(view.state.doc.length);
  await act(async () => {});
  expect(api.sqlFetch).not.toHaveBeenCalled();
});

test.each(["grilla", "fuera del editor"])("Ctrl Shift End en %s trae todas", async (place) => {
  const { grid } = await openSqlWithResults();
  const target = place === "grilla" ? grid : document.body;
  await act(async () => {
    press(target, { key: "End", ctrlKey: true, shiftKey: true });
  });
  await waitFor(() => expect(api.sqlFetch).toHaveBeenCalledWith("w5", 7, expect.anything()));
});

test("desde el editor las teclas de la app siguen actuando y Tab queda en el editor", async () => {
  const { editor, view } = await openSqlWithResults();
  expect(api.sqlExecute).toHaveBeenCalledTimes(1);
  await act(async () => {
    press(editor, { key: "Enter", ctrlKey: true });
  });
  await waitFor(() => expect(api.sqlExecute).toHaveBeenCalledTimes(2));

  act(() => view.dispatch({ selection: { anchor: 0 } }));
  act(() => {
    expect(press(editor, { key: "Tab" })).toBe(true);
  });
  expect(view.state.doc.toString()).not.toBe("SELECT id\nFROM t");
  expect(api.sqlExecute).toHaveBeenCalledTimes(2);
  act(() => {
    expect(press(editor, { key: "z", ctrlKey: true })).toBe(true);
  });
  expect(view.state.doc.toString()).toBe("SELECT id\nFROM t");

  act(() => {
    expect(press(editor, { key: "f", ctrlKey: true })).toBe(true);
  });
  expect(document.querySelector(".editor-search-bar")).toBeInTheDocument();
});

test.each(["cerrar", "desconectar"])("%s con transacción SQL abierta pide confirmación", async (action) => {
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
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Ventana SQL/ }));
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

  if (action === "desconectar") {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const disconnect = () => {
      fireEvent.click(screen.getByRole("button", { name: "Sesión" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Desconectar" }));
    };
    try {
      disconnect();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(api.disconnect).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      vi.mocked(api.disconnect).mockResolvedValue();
      disconnect();
      expect(await screen.findByText("Sesión desconectada")).toBeVisible();
      expect(editor).toBeInTheDocument();
    } finally {
      confirm.mockRestore();
    }
    return;
  }

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

test("al recuperar el foco detecta una sesión SQL caída y permite reconectarla", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w2");
  vi.mocked(api.sessionSiblings).mockResolvedValueOnce(["w2"]);
  vi.mocked(api.sessionPing).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  vi.mocked(api.reconnect).mockResolvedValue();
  render(<App />);
  await connectAs();
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  await screen.findByRole("textbox", { name: "SQL" });
  fireEvent.focus(window);
  expect(await screen.findByText("Sesión caída")).toBeVisible();
  fireEvent.focus(window);
  expect(api.sessionPing).toHaveBeenCalledTimes(2);
  await waitFor(() => {
    fireEvent.keyDown(window, { key: "F8" });
    expect(screen.getByRole("button", { name: "Reconectar sesión SQL" })).toHaveFocus();
  });
  fireEvent.click(screen.getByRole("button", { name: "Reconectar sesión SQL" }));
  await waitFor(() => expect(screen.queryByText("Sesión caída")).toBeNull());
  expect(api.reconnect).toHaveBeenCalledExactlyOnceWith("w2");
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
      columns: [{ name: "ID", type_name: "NUMBER", numeric: true, lob: false }],
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

test.each(["explorador", "consola"])("editar desde %s abre la grilla en edición", async (entry) => {
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
  if (entry === "consola") {
    vi.mocked(api.sqlOpen).mockResolvedValueOnce("cmd1");
    vi.mocked(api.completeObjects).mockResolvedValue([{ owner: "HR", name: "CLIENTES", object_type: "TABLE" }]);
  }
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
        columns: [{ name: "ID", type_name: "NUMBER", numeric: true, lob: false }],
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
          { name: "OPENPL$ROWID", type_name: "ROWID", numeric: false, lob: false },
          { name: "ID", type_name: "NUMBER", numeric: true, lob: false },
        ],
        page: { rows: [["AAA1", "1"]], more: false },
      },
      elapsed_ms: 1,
      output: [],
      transaction: false,
    });
  render(<App />);
  await connectAs();
  if (entry === "consola") {
    fireEvent.keyDown(window, { key: "n", ctrlKey: true, shiftKey: true });
    const prompt = await screen.findByRole("textbox", { name: "Comando SQL" });
    expect(prompt).toHaveFocus();
    expect(press(prompt, { key: "a", ctrlKey: true })).toBe(false);
    fireEvent.change(prompt, { target: { value: "EDIT CLIENTES" } });
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(await screen.findByRole("button", { name: "HR.CLIENTES" })).toBeVisible();
  } else {
    fireEvent.click(await screen.findByRole("treeitem", { name: "Tablas" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "CLIENTES" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Editar datos/ }));
  }
  expect(
    await screen.findByRole("button", { name: /Editando/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(api.sqlEditTarget).toHaveBeenCalledWith("w4", "HR", "CLIENTES");
  expect(api.sqlExecute).toHaveBeenCalledWith(
    "w4",
    'SELECT t.ROWID AS "OPENPL$ROWID", t.* FROM "HR"."CLIENTES" t',
    [],
  );
  if (entry === "consola") {
    fireEvent.click(screen.getByRole("button", { name: /^Comando \d+$/ }));
    expect(screen.getByRole("textbox", { name: "Comando SQL" })).toHaveFocus();
  } else {
    fireEvent.doubleClick(screen.getByRole("gridcell", { name: "ID 1" }));
    const input = screen.getByRole("textbox", { name: "Editar ID" });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("1 pendiente");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Cerrar HR.CLIENTES" }));
      expect(confirm).toHaveBeenCalledWith("Hay 1 cambio sin aplicar. ¿Descartar?");
      expect(screen.getByRole("button", { name: "HR.CLIENTES" })).toBeVisible();
      const preventDefault = vi.fn();
      windowEvents.close.mock.calls.slice(-1)[0]?.[0]({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    } finally {
      confirm.mockRestore();
    }
  }
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

function availableUpdate(install = vi.fn(async (_progress?: (pct: number | null) => void) => {})) {
  return { version: "1.0.0", notes: "Arreglos varios", install };
}

async function checkUpdatesFromMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Ayuda" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Buscar actualizaciones" }));
  });
}

test("al abrir busca actualizaciones una vez y sin versión no muestra nada", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(updater.check).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(screen.queryByRole("dialog", { name: /^OpenPL/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Estás al día")).not.toBeInTheDocument();
});

test("un error en la búsqueda silenciosa no muestra aviso", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  updater.check.mockRejectedValue(new Error("sin red"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(updater.check).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("con una versión nueva muestra el diálogo con versión y notas", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  updater.check.mockResolvedValue(availableUpdate());
  render(<App />);
  const dialog = within(await screen.findByRole("dialog", { name: "OpenPL 1.0.0" }));
  expect(dialog.getByText("Arreglos varios")).toBeVisible();
  fireEvent.click(dialog.getByRole("button", { name: "Más tarde" }));
  expect(screen.queryByRole("dialog", { name: "OpenPL 1.0.0" })).not.toBeInTheDocument();
});

test("Actualizar con cambios sin guardar y confirmación cancelada no instala", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.openProgramFile).mockResolvedValue({ name: "demo.pks", source: "PACKAGE demo AS\nEND;" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  try {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    const editor = await screen.findByRole("textbox", { name: "Spec" });
    const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n-- cambio" } }));
    await screen.findByRole("button", { name: /demo\.pks \*/ });

    const update = availableUpdate();
    updater.check.mockResolvedValue(update);
    await checkUpdatesFromMenu();
    const dialog = within(await screen.findByRole("dialog", { name: "OpenPL 1.0.0" }));
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Actualizar" })); });
    expect(confirm).toHaveBeenCalledWith("¿Descartar los cambios sin guardar?");
    expect(update.install).not.toHaveBeenCalled();
  } finally {
    confirm.mockRestore();
  }
});

test("Actualizar guarda las pestañas y después instala", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.listProfiles).mockResolvedValueOnce([{
    id: "22222222-2222-2222-2222-222222222222", name: "HR en DEV", user: "HR",
    db: "db.example.com:1521/DEV", role: "Normal", environment: "dev", save_password: false,
  }]);
  vi.mocked(api.loadWorkspace).mockResolvedValueOnce(null);
  vi.mocked(api.listObjects).mockResolvedValue([]);
  vi.mocked(api.sqlOpen).mockResolvedValue("w1");
  vi.mocked(api.connect).mockResolvedValueOnce({ session_id: "s1", server_version: "12.1.0", compat: { kind: "Supported" } });
  let release = () => {};
  const saved = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(api.saveWorkspace).mockClear();
  vi.mocked(api.saveWorkspace).mockImplementation(() => saved);
  try {
    render(<App />);
    const login = within(await screen.findByRole("dialog", { name: "Conectar a Oracle" }));
    fireEvent.click(await login.findByRole("button", { name: /^HR en DEV/ }));
    fireEvent.click(login.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(api.loadWorkspace).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Ventana SQL/ }));
    await screen.findByRole("textbox", { name: "SQL" });

    const update = availableUpdate(vi.fn(async (progress?: (pct: number | null) => void) => { progress?.(42); }));
    updater.check.mockResolvedValue(update);
    await checkUpdatesFromMenu();
    const dialog = within(await screen.findByRole("dialog", { name: "OpenPL 1.0.0" }));
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Actualizar" })); });
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalled());
    expect(update.install).not.toHaveBeenCalled();
    expect(dialog.getByRole("button", { name: "Actualizar" })).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(update.install).toHaveBeenCalledOnce());
    expect(await dialog.findByText("Descargando 42%")).toBeVisible();
  } finally {
    vi.mocked(api.saveWorkspace).mockImplementation(async () => {});
  }
});

test("si la instalación falla muestra el error y cierra el diálogo", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  const update = availableUpdate(vi.fn(async () => { throw new Error("firma inválida"); }));
  updater.check.mockResolvedValue(update);
  render(<App />);
  const dialog = await screen.findByRole("dialog", { name: "OpenPL 1.0.0" });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Actualizar" }));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("firma inválida");
  expect(dialog).not.toBeInTheDocument();
});

test("Ayuda > Buscar actualizaciones avisa si está al día o si falla", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(updater.check).toHaveBeenCalledOnce());
  await checkUpdatesFromMenu();
  expect(await screen.findByRole("status")).toHaveTextContent("Estás al día");
  updater.check.mockRejectedValue(new Error("sin red"));
  await checkUpdatesFromMenu();
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo buscar actualizaciones");
});

test("Abrir un menú de la barra cierra Nuevo", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  const archivo = screen.getByRole("button", { name: "Archivo" });
  fireEvent.mouseDown(archivo); fireEvent.click(archivo);
  expect(screen.queryByRole("menu", { name: "Archivo" })).toBeInTheDocument();
  expect(screen.queryByRole("menu", { name: "Nuevo" })).not.toBeInTheDocument();
});
test("Abrir Nuevo cierra el menú de la barra", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Archivo" }));
  const nuevo = screen.getByRole("button", { name: "Nuevo" });
  fireEvent.mouseDown(nuevo); fireEvent.click(nuevo);
  expect(screen.queryByRole("menu", { name: "Nuevo" })).toBeInTheDocument();
  expect(screen.queryByRole("menu", { name: "Archivo" })).not.toBeInTheDocument();
});
test("Alt cierra Nuevo al abrir la barra", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Nuevo" }));
  fireEvent.keyDown(document, { key: "Alt" }); fireEvent.keyUp(document, { key: "Alt" });
  expect(screen.queryByRole("menu", { name: "Nuevo" })).not.toBeInTheDocument();
});

test("una actualización encontrada deja el ícono tras Más tarde", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  updater.check.mockResolvedValue({ version: "9.9.9", notes: "", install: vi.fn() });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Más tarde" }));
  expect(screen.queryByRole("dialog", { name: "OpenPL 9.9.9" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Actualización disponible: 9.9.9" }));
  expect(screen.getByRole("dialog", { name: "OpenPL 9.9.9" })).toBeInTheDocument();
});

test("sin actualización no hay ícono", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  render(<App />);
  await screen.findByRole("button", { name: "Cancelar" });
  expect(screen.queryByRole("button", { name: /Actualización disponible/ })).not.toBeInTheDocument();
});

test("F12 sobre un miembro de otro paquete lo abre en su declaración", async () => {
  windowEvents.close.mockResolvedValue(() => {});
  vi.mocked(api.programSource).mockReset();
  const pkgA = { owner: "HR", name: "PKG_A", object_type: "Package" as const, status: "Valid" as const, last_ddl_time: "2026-01-01T12:00:00" };
  const pkgOtro = { ...pkgA, name: "PKG_OTRO" };
  vi.mocked(api.listObjects).mockResolvedValue([pkgA]);
  const source = "CREATE OR REPLACE PACKAGE PKG_A AS\n  c NUMBER := pkg_otro.hacer;\nEND;";
  const other = "CREATE OR REPLACE PACKAGE PKG_OTRO AS\n  FUNCTION hacer RETURN NUMBER;\nEND;";
  vi.mocked(api.programSource).mockImplementation(async (_session, _type, _owner, name) => [
    { kind: "PACKAGE", source: name === "PKG_OTRO" ? other : source, last_ddl_time: null, diagnostics: [] },
  ]);
  vi.mocked(api.editorObject).mockImplementation(async (_session, reference) =>
    reference.name === "PKG_OTRO" ? pkgOtro : null);
  render(<App />);
  await connectAs();
  fireEvent.click(await screen.findByRole("treeitem", { name: "Paquetes" }));
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "PKG_A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Editar Spec y Body" }));
  const editor = await screen.findByRole("textbox", { name: "Spec" });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => view.dispatch({ selection: { anchor: source.indexOf("hacer") + 1 } }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "F12" });
  });
  await waitFor(() => {
    const opened = EditorView.findFromDOM(
      screen.getByRole("textbox", { name: "Spec" }).closest<HTMLElement>(".cm-editor")!,
    )!;
    expect(opened.state.doc.toString()).toBe(other);
    expect(opened.state.selection.main.head).toBe(other.indexOf("hacer"));
  });
});
