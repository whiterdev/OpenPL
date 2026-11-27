import { expect, test } from "vitest";
import { navigationTargets } from "./editorNavigation";
import type { ProgramSymbol } from "./programSymbols";
import type { Resolved } from "./symbolResolve";

const routine = (part: number, definition: boolean, signature = "PROCEDURE p(a NUMBER)"): Resolved => ({
  kind: "symbol",
  symbol: {
    kind: "procedure", name: "P", signature, dataType: null, value: null, comment: null,
    from: part * 100, scope: null, definition, container: null,
  } satisfies ProgramSymbol,
  location: { where: "here", part, from: part * 100, line: 1, column: 1 },
});

const parts = (choice: ReturnType<typeof navigationTargets>) =>
  choice.targets.map((target) => target.location.where === "here" && target.location.part);

test("definición prefiere el cuerpo", () => {
  expect(parts(navigationTargets([routine(0, false), routine(1, true)], "definition"))).toEqual([1]);
});

test("declaración prefiere la spec", () => {
  expect(parts(navigationTargets([routine(0, false), routine(1, true)], "declaration"))).toEqual([0]);
});

test("implementación sin cuerpo avisa", () => {
  const choice = navigationTargets([routine(0, false)], "implementation");
  expect(parts(choice)).toEqual([0]);
  expect(choice.notice).toBe("Cuerpo no disponible");
});

test("sobrecargas dan varios destinos", () => {
  const choice = navigationTargets([
    routine(0, false), routine(1, true),
    routine(0, false, "PROCEDURE p(a VARCHAR2)"), routine(1, true, "PROCEDURE p(a VARCHAR2)"),
  ], "definition");
  expect(parts(choice)).toEqual([1, 1]);
  expect(choice.targets.map((target) => target.label)).toEqual(["PROCEDURE p(a NUMBER)", "PROCEDURE p(a VARCHAR2)"]);
});

test("una variable no pide cuerpo", () => {
  const variable: Resolved = {
    kind: "symbol",
    symbol: { ...(routine(0, false) as { symbol: ProgramSymbol }).symbol, kind: "variable", signature: "v NUMBER" },
    location: { where: "here", part: 0, from: 5, line: 1, column: 6 },
  };
  const choice = navigationTargets([variable], "implementation");
  expect(choice.targets).toHaveLength(1);
  expect(choice.notice).toBeUndefined();
});

test("columnas y tablas no dan destinos de código", () => {
  expect(navigationTargets([{ kind: "column", table: "T", column: { name: "C", data_type: "NUMBER", nullable: true } }], "definition").targets).toEqual([]);
});
