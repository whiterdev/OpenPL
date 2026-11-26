import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useState } from "react";
import { ResultGrid, type CellPosition } from "./ResultGrid";
import type { SqlColumn } from "../types";
import type { Cell } from "../gridEdits";
import { copyGridCells, gridTotal } from "../gridSelection";

const columns: SqlColumn[] = [
  { name: "ID", type_name: "NUMBER", numeric: true, lob: false },
  { name: "NOMBRE", type_name: "VARCHAR2", numeric: false, lob: false },
];
const rows: Cell[][] = [["1", "Ana"], ["2", "Luis"]];

function grid(queryKey = 1, onSelect = vi.fn()) {
  return (
    <ResultGrid queryKey={queryKey} columns={columns} rows={rows} status={[null, null]} isModified={() => false}
      editable={null} selected={null} onSelect={onSelect} onEdit={vi.fn()} fetching={false}
      fetchError={null} />
  );
}

const header = () => screen.getAllByRole("row")[0] as HTMLElement;

test("Ctrl+A en la grilla selecciona las filas cargadas", () => {
  const onSelect = vi.fn();
  render(grid(1, onSelect));
  const scroll = screen.getByRole("presentation");
  scroll.focus();
  expect(fireEvent.keyDown(scroll, { key: "a", ctrlKey: true })).toBe(false);
  expect(onSelect).toHaveBeenCalledWith({ row: 0, col: 0, scope: "all" });
});

test("Shift con clic y flechas extiende mientras Ctrl agrega otra celda", () => {
  function Grid() {
    const [selected, onSelect] = useState<CellPosition | null>(null);
    return <ResultGrid queryKey={1} columns={columns} rows={rows} status={[]} isModified={() => false}
      editable={null} selected={selected} onSelect={onSelect} onEdit={vi.fn()} fetching={false} fetchError={null} />;
  }
  render(<Grid />);
  const id = screen.getByRole("gridcell", { name: "ID 1" });
  const name = screen.getByRole("gridcell", { name: "NOMBRE Ana" });
  const last = screen.getByRole("gridcell", { name: "NOMBRE Luis" });
  fireEvent.mouseDown(id);
  fireEvent.mouseUp(window);
  fireEvent.mouseDown(name, { shiftKey: true });
  fireEvent.mouseUp(window);
  expect(id).toHaveAttribute("aria-selected", "true");
  expect(name).toHaveAttribute("aria-selected", "true");
  fireEvent.mouseDown(last, { ctrlKey: true });
  fireEvent.mouseUp(window);
  expect(last).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("gridcell", { name: "ID 2" })).toHaveAttribute("aria-selected", "false");
  fireEvent.keyDown(screen.getByRole("presentation"), { key: "ArrowLeft", shiftKey: true });
  expect(screen.getByRole("gridcell", { name: "ID 2" })).toHaveAttribute("aria-selected", "true");
});

test("la esquina selecciona las filas cargadas y el numero selecciona una fila", () => {
  const onSelect = vi.fn();
  render(grid(1, onSelect));
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar filas cargadas" }));
  expect(onSelect).toHaveBeenLastCalledWith({ row: 0, col: 0, scope: "all" });
  fireEvent.click(screen.getByRole("button", { name: "Seleccionar fila 2" }));
  expect(onSelect).toHaveBeenLastCalledWith({ row: 1, col: 0, scope: "row" });
});

test("el menu muestra totales numericos de la seleccion", () => {
  const onSelect = vi.fn();
  render(<ResultGrid queryKey={1} columns={columns} rows={rows} status={[null, null]}
    isModified={() => false} editable={null} selected={{ row: 0, col: 0, scope: "all" }}
    onSelect={onSelect} onEdit={vi.fn()} fetching={false} fetchError={null} />);
  const cell = screen.getByRole("gridcell", { name: "ID 2" });
  fireEvent.mouseDown(cell, { button: 2 });
  fireEvent.contextMenu(cell);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("menuitem", { name: "Totales de columna" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Suma" }));
  const footer = screen.getByRole("row", { name: "Totales de columna" });
  expect(footer.style.gridTemplateColumns).toBe(header().style.gridTemplateColumns);
  expect(within(footer).getByRole("gridcell", { name: "ID · Suma" })).toHaveTextContent("3");

  fireEvent.contextMenu(screen.getByRole("gridcell", { name: "NOMBRE Luis" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Totales de columna" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Conteo" }));
  expect(within(footer).getByRole("gridcell", { name: "NOMBRE · Conteo" })).toHaveTextContent("2");
  expect(within(footer).getByRole("gridcell", { name: "ID · Suma" })).toHaveTextContent("3");
  fireEvent.contextMenu(cell);
  fireEvent.click(screen.getByRole("menuitem", { name: "Totales de columna" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Limpiar todos" }));
  expect(footer).not.toBeInTheDocument();
});

test("el tooltip de celda solo aparece cuando el contenido desborda", () => {
  render(grid());
  const cell = screen.getByRole("gridcell", { name: "NOMBRE Ana" });
  Object.defineProperty(cell, "clientWidth", { value: 24 });
  Object.defineProperty(cell, "scrollWidth", { value: 25, configurable: true });
  fireEvent.mouseEnter(cell);
  expect(cell).toHaveAttribute("title", "Ana");
  Object.defineProperty(cell, "scrollWidth", { value: 24 });
  fireEvent.mouseLeave(cell);
  fireEvent.mouseEnter(cell);
  expect(cell).not.toHaveAttribute("title");
});

test("un total indica cuando quedan filas por traer", () => {
  render(<ResultGrid queryKey={1} columns={columns} rows={rows} status={[]} isModified={() => false}
    editable={null} selected={null} onSelect={vi.fn()} onEdit={vi.fn()} fetching={false} fetchError={null} more />);
  fireEvent.contextMenu(screen.getByRole("columnheader", { name: "ID" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Totales de columna" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Suma" }));
  expect(screen.getByRole("rowheader", { name: "Total parcial" })).toHaveAttribute("title", "Parcial, 2 filas cargadas");
});

test("Escape cancela la edición y pegar TSV recorta al rango disponible", () => {
  const onEdit = vi.fn();
  const onPasteCells = vi.fn();
  const onNotice = vi.fn();
  render(<ResultGrid queryKey={1} columns={columns} rows={rows} status={[]} isModified={() => false}
    editable={[true, true]} selected={{ row: 1, col: 1 }} onSelect={vi.fn()} onEdit={onEdit}
    onPasteCells={onPasteCells} onNotice={onNotice} fetching={false} fetchError={null} />);
  const scroll = screen.getByRole("presentation");
  fireEvent.keyDown(scroll, { key: "F2" });
  const editing = screen.getByRole("textbox", { name: "Editar NOMBRE" });
  fireEvent.change(editing, { target: { value: "descartar" } });
  fireEvent.keyDown(editing, { key: "Escape" });
  expect(onEdit).not.toHaveBeenCalled();
  fireEvent.keyDown(scroll, { key: "F2" });
  fireEvent.paste(screen.getByRole("textbox", { name: "Editar NOMBRE" }), {
    clipboardData: { getData: () => '"Nueva\tcelda"\tsobra\r\notra\tfila' },
  });
  expect(onPasteCells).toHaveBeenCalledExactlyOnceWith({ row: 1, col: 1 }, [["Nueva\tcelda"]]);
  expect(onNotice).toHaveBeenCalledWith("Se pegaron 1 de 4 celdas");
  expect(onEdit).not.toHaveBeenCalled();
});

test("CSV escapa comas y comillas y la suma conserva decimales exactos", () => {
  expect(copyGridCells([["1", 'A,"B"'], ["2", null]], true)).toBe('1,"A,""B"""\r\n2,');
  expect(copyGridCells([["1", "Ana"], ["2", null]], false)).toBe("1\tAna\n2\t");
  expect(gridTotal(["999999999999999999.1", null, "0.2", "-2e-1"], "sum")).toBe("999999999999999999.1");
  expect(gridTotal(["999999999999999999.1", "999999999999999999.2"], "average")).toBe("999999999999999999.15");
  expect(gridTotal(["-10", null, "-9.9"], "min")).toBe("-10");
  expect(gridTotal(["-10", null, "-9.9"], "max")).toBe("-9.9");
  expect(gridTotal(["Ana", null, "Luis"], "count")).toBe("2");
});
const handle = (name: string) => screen.getByRole("separator", { name: `Ancho de ${name}` });

test("arrastrar el borde del encabezado cambia el ancho de la columna", () => {
  render(grid());
  expect(header().style.gridTemplateColumns).toBe("64px 64px 65px");
  fireEvent.pointerDown(handle("NOMBRE"), { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 200, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(header().style.gridTemplateColumns).toBe("64px 64px 165px");
  expect(screen.getAllByRole("row")[1].style.gridTemplateColumns).toBe("64px 64px 165px");
  expect(handle("NOMBRE")).toHaveAttribute("aria-valuenow", "165");
  fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 });
  expect(header().style.gridTemplateColumns).toBe("64px 64px 165px");
});

test("el arrastre respeta el mínimo y el máximo", () => {
  render(grid());
  fireEvent.pointerDown(handle("ID"), { clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 0, pointerId: 1 });
  expect(header().style.gridTemplateColumns).toBe("64px 40px 65px");
  fireEvent.pointerMove(window, { clientX: 5000, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(header().style.gridTemplateColumns).toBe("64px 1200px 65px");
});

test("doble clic en el borde restaura el ancho automático", () => {
  render(grid());
  fireEvent.pointerDown(handle("NOMBRE"), { clientX: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  fireEvent.doubleClick(handle("NOMBRE"));
  expect(header().style.gridTemplateColumns).toBe("64px 64px 65px");
});

test("las flechas en el borde cambian el ancho sin mover la celda", () => {
  const onSelect = vi.fn();
  render(grid(1, onSelect));
  fireEvent.keyDown(handle("NOMBRE"), { key: "ArrowRight" });
  expect(header().style.gridTemplateColumns).toBe("64px 64px 81px");
  fireEvent.keyDown(handle("NOMBRE"), { key: "ArrowLeft" });
  fireEvent.keyDown(handle("NOMBRE"), { key: "ArrowLeft" });
  expect(header().style.gridTemplateColumns).toBe("64px 64px 49px");
  expect(onSelect).not.toHaveBeenCalled();
});

test("una consulta nueva reinicia los anchos", () => {
  const { rerender } = render(grid(1));
  fireEvent.keyDown(handle("NOMBRE"), { key: "ArrowRight" });
  expect(header().style.gridTemplateColumns).toBe("64px 64px 81px");
  rerender(grid(1));
  expect(header().style.gridTemplateColumns).toBe("64px 64px 81px");
  rerender(grid(2));
  expect(header().style.gridTemplateColumns).toBe("64px 64px 65px");
});
