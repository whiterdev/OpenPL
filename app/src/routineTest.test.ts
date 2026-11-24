import { expect, test } from "vitest";
import { routineDraft } from "./routineTest";
import { splitScript } from "./sqlScript";

test("prepara un procedimiento sin argumentos en un solo bloque", () => {
  const sql = routineDraft(["HR", "PKG", "RUN"], { subprogram_id: 1, parameters: [], returns: null });
  expect(sql).toBe('BEGIN\n  "HR"."PKG"."RUN"();\nEND;\n/');
  expect(splitScript(sql)).toHaveLength(1);
});

test("tipa entradas, salidas y retorno para una funcion sobrecargada", () => {
  const sql = routineDraft(["HR", "PKG", "READ"], {
    subprogram_id: 2,
    parameters: [
      { declaration: { name: "ID", data_type: "NUMBER", direction: "IN" } },
      { declaration: { name: "NAME", data_type: "VARCHAR2", direction: "OUT" } },
    ],
    returns: { declaration: { name: null, data_type: "NUMBER", direction: "OUT" } },
  });
  expect(sql).toContain("p1 NUMBER := :p1;");
  expect(sql).toContain("p2 VARCHAR2(32767);");
  expect(sql).toContain('resultado := "HR"."PKG"."READ"("ID" => p1, "NAME" => p2);');
  expect(sql).toContain("DBMS_OUTPUT.PUT_LINE('resultado: ' || resultado);");
  expect(splitScript(sql)).toHaveLength(1);
});
