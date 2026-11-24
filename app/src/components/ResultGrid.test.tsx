import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ResultGrid } from "./ResultGrid";
import type { SqlColumn } from "../types";
import type { Cell } from "../gridEdits";
import { copyGridCells, sumGridNumbers } from "../gridSelection";

const columns: SqlColumn[] = [
  { name: "ID", type_name: "NUMBER", numeric: true },
  { name: "NOMBRE", type_name: "VARCHAR2", numeric: false },
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
  fireEvent.click(screen.getByRole("menuitem", { name: "Sumar columnas numéricas" }));
  expect(screen.getByRole("status")).toHaveTextContent("ID: 3");
  expect(screen.getByRole("status")).not.toHaveTextContent("NOMBRE");
});

test("CSV escapa comas y comillas y la suma conserva decimales exactos", () => {
  expect(copyGridCells([["1", 'A,"B"'], ["2", null]], true)).toBe('1,"A,""B"""\r\n2,');
  expect(copyGridCells([["1", "Ana"], ["2", null]], false)).toBe("1\tAna\n2\t");
  expect(sumGridNumbers(["999999999999999999.1", null, "0.2", "-2e-1"])).toBe("999999999999999999.1");
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
