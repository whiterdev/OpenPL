import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObjectBrowser } from "./ObjectBrowser";
import { api } from "../api";
import type { ActiveConnection, ObjectInfo } from "../types";

vi.mock("../api", () => ({ api: { listObjects: vi.fn() } }));
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
  beforeEach(() => {
    vi.resetAllMocks();
    m.listObjects.mockResolvedValue([obj("PKG_A"), obj("PKG_B", { status: "Invalid" })]);
  });
  afterEach(() => vi.useRealTimers());

  test("muestra los 9 tipos en orden y no consulta hasta expandir", () => {
    renderBrowser();
    const labels = screen
      .getAllByRole("treeitem")
      .filter((n) => n.getAttribute("aria-level") === "1")
      .map((n) => n.getAttribute("aria-label"));
    expect(labels).toEqual(["Paquetes", "Procedimientos", "Funciones", "Triggers", "Tipos", "Tablas", "Vistas", "Secuencias", "Sinónimos"]);
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
    expect(await screen.findByText("error")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Refrescar/ }));
    expect(await screen.findByText("PKG_A")).toBeInTheDocument();
    expect(screen.queryByText("error")).toBeNull();
  });

  test("muestra el contador del tipo cargado", async () => {
    renderBrowser();
    await userEvent.click(screen.getByRole("treeitem", { name: "Paquetes" }));
    await screen.findByText("PKG_A");
    expect(within(screen.getByRole("treeitem", { name: "Paquetes" })).getByText("2")).toBeInTheDocument();
  });
});
