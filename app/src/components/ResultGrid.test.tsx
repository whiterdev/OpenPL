import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ResultGrid } from "./ResultGrid";
import type { SqlColumn } from "../types";
import type { Cell } from "../gridEdits";

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
