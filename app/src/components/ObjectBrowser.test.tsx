import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectBrowser } from "./ObjectBrowser";
import { api } from "../api";
import type { ActiveConnection, ObjectInfo } from "../types";

vi.mock("../api", () => ({ api: { listObjects: vi.fn(), objectDdl: vi.fn(), recompile: vi.fn() } }));
const m = vi.mocked(api);

const conn: ActiveConnection = {
  sessionId: "s1",
  label: "HR en DEV",
  environment: "dev",
  serverVersion: "12.1.0",
  compat: { kind: "Supported" },
};

const obj = (name: string, extra: Partial<ObjectInfo> = {}): ObjectInfo => ({
  owner: "HR",
  name,
  object_type: "Package",
  status: "Valid",
  last_ddl_time: "2024-01-01T00:00:00",
  ...extra,
});

function renderBrowser(props: Partial<Parameters<typeof ObjectBrowser>[0]> = {}) {
  return render(
    <ObjectBrowser connection={conn} onOpenObject={vi.fn()} onConnectionLost={vi.fn()} refreshKey={0} {...props} />,
  );
}

describe("ObjectBrowser", () => {
  test("Editar Spec y Body abre un borrador", async () => {
    const onOpenObject = vi.fn();
    renderBrowser({ onOpenObject });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "PKG_A" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar Spec y Body" }));
    expect(onOpenObject).toHaveBeenCalledWith(obj("PKG_A"), "edit");
  });

  beforeEach(() => {
    vi.resetAllMocks();
    m.listObjects.mockResolvedValue([obj("PKG_A"), obj("PKG_B", { status: "Invalid" })]);
  });
  afterEach(() => vi.useRealTimers());

  test("muestra todos los tipos en orden y no consulta hasta expandir", () => {
    renderBrowser();
    const labels = screen
      .getAllByRole("treeitem")
      .filter((n) => n.getAttribute("aria-level") === "1")
      .map((n) => n.getAttribute("aria-label"));
    expect(labels).toHaveLength(35);
    expect(labels.slice(0, 5)).toEqual(["Paquetes", "Procedimientos", "Funciones", "Triggers", "Tipos"]);
    for (const l of ["Tablas", "Índices", "Vistas", "Usuarios", "Roles", "Jobs", "DBMS_Jobs", "Programas", "Database links", "Tablespaces"])
      expect(labels).toContain(l);
    expect(labels[labels.length - 1]).toBe("Papelera");
    expect(m.listObjects).not.toHaveBeenCalled();
  });

  test("expandir Paquetes consulta solo ese tipo con Scope Mine", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    expect(m.listObjects).toHaveBeenCalledTimes(1);
    expect(m.listObjects).toHaveBeenCalledWith("s1", "Mine", "Package", null);
    expect(await screen.findByText("PKG_A")).toBeInTheDocument();
  });

  test("objeto inválido se marca", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    const item = await screen.findByRole("treeitem", { name: /PKG_B/ });
    expect(item.getAttribute("aria-label")).toContain("inválido");
    expect(within(item).getByText("inválido")).toBeInTheDocument();
  });

  test("filtro consulta de nuevo con el texto tras 300 ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBrowser();
    await user.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await user.type(screen.getByLabelText("Filtrar objetos"), "pkg_v");
    expect(m.listObjects).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(m.listObjects).toHaveBeenLastCalledWith("s1", "Mine", "Package", "pkg_v");
  });

  test("cambiar a Todos muestra owner.nombre", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await userEvent.click(screen.getByRole("radio", { name: "Todos" }));
    expect(m.listObjects).toHaveBeenLastCalledWith("s1", "All", "Package", null);
    expect(await screen.findByText("HR.PKG_A")).toBeInTheDocument();
  });

  test("doble clic llama onOpenObject", async () => {
    const onOpenObject = vi.fn();
    renderBrowser({ onOpenObject });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await userEvent.dblClick(await screen.findByText("PKG_A"));
    expect(onOpenObject).toHaveBeenCalledWith(obj("PKG_A"));
  });

  test("Enter sobre un objeto llama onOpenObject", async () => {
    const onOpenObject = vi.fn();
    renderBrowser({ onOpenObject });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    (await screen.findByRole("treeitem", { name: /PKG_A/ })).focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenObject).toHaveBeenCalledWith(obj("PKG_A"));
  });

  test("error ConnectionLost llama onConnectionLost", async () => {
    m.listObjects.mockRejectedValue({ Db: { code: "ORA-03113", kind: "ConnectionLost", message: "x" } });
    const onConnectionLost = vi.fn();
    renderBrowser({ onConnectionLost });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await vi.waitFor(() => expect(onConnectionLost).toHaveBeenCalled());
  });

  test("Refrescar vuelve a consultar los tipos expandidos", async () => {
    const { rerender } = renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await screen.findByText("PKG_A");
    rerender(<ObjectBrowser connection={conn} onOpenObject={vi.fn()} onConnectionLost={vi.fn()} refreshKey={1} />);
    await vi.waitFor(() => expect(m.listObjects).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("button", { name: /Refrescar/ }));
    await vi.waitFor(() => expect(m.listObjects).toHaveBeenCalledTimes(3));
  });

  test("con miles de objetos no dibuja todas las filas", async () => {
    m.listObjects.mockResolvedValue(Array.from({ length: 3000 }, (_, i) => obj(`PKG_${i}`)));
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await vi.waitFor(() => expect(m.listObjects).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryAllByRole("treeitem").length).toBeLessThan(500);
  });

  test("refrescar durante una carga no deja datos viejos", async () => {
    let viejo: (v: ObjectInfo[]) => void = () => {};
    m.listObjects
      .mockReturnValueOnce(new Promise<ObjectInfo[]>((r) => (viejo = r)))
      .mockResolvedValueOnce([obj("PKG_NUEVO")]);
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await userEvent.click(screen.getByRole("button", { name: /Refrescar/ }));
    await vi.waitFor(() => expect(m.listObjects).toHaveBeenCalledTimes(2));
    await act(async () => viejo([obj("PKG_VIEJO")]));
    expect(await screen.findByText("PKG_NUEVO")).toBeInTheDocument();
    expect(screen.queryByText("PKG_VIEJO")).toBeNull();
  });

  test("tras un error, un refresco exitoso quita la marca de error", async () => {
    m.listObjects
      .mockRejectedValueOnce({ Db: { code: "ORA-00942", kind: "Other", message: "x" } })
      .mockResolvedValueOnce([obj("PKG_A")]);
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    expect(await screen.findByText("ORA-00942 x")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Refrescar/ }));
    expect(await screen.findByText("PKG_A")).toBeInTheDocument();
    expect(screen.queryByText("ORA-00942 x")).toBeNull();
  });

  test("clic derecho en un objeto abre el menú contextual con atajos", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_A/ }));
    const menu = screen.getByRole("menu", { name: /PKG_A/ });
    expect(within(menu).getByRole("menuitem", { name: /Abrir/ })).toHaveTextContent("Enter");
    expect(within(menu).getByRole("menuitem", { name: /Probar/ })).toHaveTextContent("Ctrl T");
    expect(within(menu).getByRole("menuitem", { name: /Refrescar/ })).toHaveTextContent("Ctrl R");
  });

  test("Abrir del menú contextual llama onOpenObject y cierra el menú", async () => {
    const onOpenObject = vi.fn();
    renderBrowser({ onOpenObject });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_A/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Abrir/ }));
    expect(onOpenObject).toHaveBeenCalledWith(obj("PKG_A"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("Copiar nombre con esquema copia OWNER.NOMBRE", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_A/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copiar nombre con esquema/ }));
    expect(writeText).toHaveBeenCalledWith("HR.PKG_A");
  });

  test("Escape cierra el menú contextual", async () => {
    renderBrowser();
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Paquetes" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("clic derecho en un tipo ofrece Refrescar", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await screen.findByText("PKG_A");
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Refrescar/ }));
    await vi.waitFor(() => expect(m.listObjects).toHaveBeenCalledTimes(2));
  });

  test("objetos sin dueño (usuarios, roles) se muestran solo con su nombre", async () => {
    m.listObjects.mockResolvedValue([obj("HR", { owner: "", object_type: "User" })]);
    renderBrowser();
    await userEvent.click(screen.getByRole("radio", { name: "Todos" }));
    await userEvent.click(screen.getByRole("treeitem", { name: "Usuarios" }));
    expect(m.listObjects).toHaveBeenLastCalledWith("s1", "All", "User", null);
    expect(await screen.findByRole("treeitem", { name: "HR" })).toBeInTheDocument();
  });

  test("una carpeta con error muestra el motivo y permite reintentar solo ese tipo", async () => {
    m.listObjects
      .mockRejectedValueOnce({ Db: { code: "ORA-00942", kind: "Other", message: "la tabla o vista no existe" } })
      .mockResolvedValueOnce([obj("PKG_A")]);
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    expect(await screen.findByText("ORA-00942 la tabla o vista no existe")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar Paquetes" }));
    expect(await screen.findByText("PKG_A")).toBeInTheDocument();
    expect(screen.queryByText(/ORA-00942/)).toBeNull();
  });

  test("una carpeta muestra carga y vacío", async () => {
    let resolve!: (value: ObjectInfo[]) => void;
    m.listObjects.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
    await act(async () => resolve([]));
    expect(screen.getByText("Sin objetos")).toBeInTheDocument();
  });

  test("las opciones pendientes se marcan como próximamente", async () => {
    m.listObjects.mockResolvedValue([obj("CLIENTES", { object_type: "Table" })]);
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Tablas" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /CLIENTES/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Consultar datos.*Próximamente/ })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: /Copiar DDL/ })).not.toHaveTextContent("Próximamente");
  });

  test("menú de una tabla: consultar y editar datos, y DDL", async () => {
    m.listObjects.mockResolvedValue([obj("CLIENTES", { object_type: "Table" })]);
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Tablas" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /CLIENTES/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Consultar datos/ })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: /Editar datos/ })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: /Copiar DDL/ })).toBeEnabled();
    expect(within(menu).queryByRole("menuitem", { name: /Recompilar/ })).toBeNull();
  });

  test("menú de una vista: consulta datos y Editar datos deshabilitado", async () => {
    const onQueryData = vi.fn();
    const v = obj("V_CLIENTES", { object_type: "View" });
    m.listObjects.mockResolvedValue([v]);
    renderBrowser({ onQueryData, onEditData: vi.fn() });
    await userEvent.click(screen.getByRole("treeitem", { name: "Vistas" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /V_CLIENTES/ }));
    const menu = screen.getByRole("menu");
    const edit = within(menu).getByRole("menuitem", { name: /Editar datos/ });
    expect(edit).toBeDisabled();
    expect(edit).not.toHaveTextContent("Próximamente");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Consultar datos/ }));
    expect(onQueryData).toHaveBeenCalledWith(v);
  });

  test("menú de un usuario: opciones propias y Copiar DDL", async () => {
    m.listObjects.mockResolvedValue([obj("HR", { owner: "", object_type: "User" })]);
    m.objectDdl.mockResolvedValue("CREATE USER HR");
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Usuarios" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /HR/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Editar usuario.*Próximamente/ })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: /Privilegios.*Próximamente/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Copiar DDL/ }));
    expect(m.objectDdl).toHaveBeenCalledWith("s1", "User", "", "HR");
  });

  test("menú de un paquete: Spec y Body, y Recompilar habilitado", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_A/ }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Editar Spec y Body/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /^Recompilar/ })).toBeEnabled();
  });

  test("Copiar DDL copia el DDL y avisa", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    m.objectDdl.mockResolvedValue("CREATE PACKAGE ...;");
    const onNotice = vi.fn();
    renderBrowser({ onNotice });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_A/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copiar DDL/ }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("CREATE PACKAGE ...;"));
    expect(m.objectDdl).toHaveBeenCalledWith("s1", "Package", "HR", "PKG_A");
    expect(onNotice).toHaveBeenCalledWith("DDL copiado");
  });

  test("Recompilar recompila y vuelve a consultar el tipo", async () => {
    m.recompile.mockResolvedValue({ with_errors: true });
    const onNotice = vi.fn();
    renderBrowser({ onNotice });
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_B/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Recompilar/ }));
    await vi.waitFor(() => expect(m.recompile).toHaveBeenCalledWith("s1", "Package", "HR", "PKG_B"));
    await vi.waitFor(() => expect(m.listObjects).toHaveBeenCalledTimes(2));
    expect(onNotice).toHaveBeenCalledWith("PKG_B compilado con errores");
  });

  test("en producción Recompilar pide confirmación", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <ObjectBrowser connection={{ ...conn, environment: "prod" }} onOpenObject={vi.fn()} onConnectionLost={vi.fn()} refreshKey={0} />,
    );
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /PKG_A/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Recompilar/ }));
    expect(confirm).toHaveBeenCalled();
    expect(m.recompile).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  test("menú de una carpeta copia los nombres separados por coma", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await screen.findByText("PKG_A");
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Paquetes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Copiar nombres separados por coma/ }));
    expect(writeText).toHaveBeenCalledWith("PKG_A, PKG_B");
  });

  test("muestra el contador del tipo cargado", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await screen.findByText("PKG_A");
    expect(within(screen.getByRole("treeitem", { name: "Paquetes" })).getByText("2")).toBeInTheDocument();
  });
});
