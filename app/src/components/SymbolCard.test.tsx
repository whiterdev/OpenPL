import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SymbolCard } from "./SymbolCard";
import type { Resolved } from "../symbolResolve";
import type { ProgramSymbol } from "../programSymbols";
import type { ObjectInfo } from "../types";

const pkg: ObjectInfo = { owner: "HR", name: "PKG_VENTAS", object_type: "Package", status: "Valid", last_ddl_time: "" };

const symbol = (overrides: Partial<ProgramSymbol>): ProgramSymbol => ({
  kind: "variable", name: "X", signature: "x NUMBER", dataType: "NUMBER", value: null,
  comment: null, from: 0, scope: null, definition: false, container: null, ...overrides,
});
const here = { where: "here" as const, part: 0, from: 0, line: 1 };

test("constante muestra tipo y valor", () => {
  const items: Resolved[] = [{
    kind: "symbol",
    symbol: symbol({ kind: "constant", name: "C_MAX", signature: "c_max CONSTANT NUMBER := 3", value: "3" }),
    location: here,
  }];
  render(<SymbolCard items={items} />);
  expect(screen.getByText("NUMBER := 3")).toBeVisible();
  expect(screen.getByText("Constante")).toBeVisible();
});

test("variable sin valor", () => {
  render(<SymbolCard items={[{ kind: "symbol", symbol: symbol({}), location: here }]} />);
  expect(screen.getByText("Sin valor inicial")).toBeVisible();
});

test("ubicación con línea y comentario", () => {
  const items: Resolved[] = [{
    kind: "symbol",
    symbol: symbol({ kind: "function", signature: "FUNCTION calcular RETURN NUMBER", comment: "Calcula el total" }),
    location: { where: "object", object: pkg, partKind: "PACKAGE BODY", from: 0, line: 12 },
  }];
  render(<SymbolCard items={items} />);
  expect(screen.getByText("FUNCTION calcular RETURN NUMBER")).toBeVisible();
  expect(screen.getByText("PKG_VENTAS · Body · línea 12")).toBeVisible();
  expect(screen.getByText("Calcula el total")).toBeVisible();
});

test("relación lista columnas", () => {
  const items: Resolved[] = [{
    kind: "relation",
    object: { ...pkg, name: "CLIENTES", object_type: "Table" },
    columns: [
      { name: "ID", data_type: "NUMBER", nullable: false },
      { name: "NOMBRE", data_type: "VARCHAR2(100)", nullable: true },
    ],
  }];
  render(<SymbolCard items={items} />);
  expect(screen.getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText("VARCHAR2(100)")).toBeVisible();
});

test("objeto sin fuente", () => {
  render(<SymbolCard items={[{ kind: "object", object: pkg, note: "Fuente no disponible" }]} />);
  expect(screen.getByText("Fuente no disponible")).toBeVisible();
});
