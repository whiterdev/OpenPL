import { expect, test } from "vitest";
import { routineDraft } from "./routineTest";
import { splitScript } from "./sqlScript";

test("prepara un procedimiento sin argumentos en un solo bloque", () => {
  const sql = routineDraft(["HR", "PKG", "RUN"], { subprogram_id: 1, parameters: [], returns: null });
  expect(sql.source).toBe('BEGIN\n  "HR"."PKG"."RUN"();\nEND;\n/');
  expect(splitScript(sql.source)).toHaveLength(1);
});

test("tipa entradas, salidas y retorno para una funcion sobrecargada", () => {
  const sql = routineDraft(["HR", "PKG", "READ"], {
    subprogram_id: 2,
    parameters: [
      { declaration: { name: "ID", data_type: "NUMBER", direction: "IN" } },
      { declaration: { name: "NAME", data_type: "VARCHAR2", direction: "OUT" } },
    ],
    returns: { declaration: { name: null, data_type: "NUMBER", direction: "OUT" } },
  }, true);
  expect(sql.source).toContain("v_p1 NUMBER := :ID;");
  expect(sql.source).toContain("v_p2 VARCHAR2(32767);");
  expect(sql.source).toContain('resultado := "HR"."PKG"."READ"(\n    "ID"   => v_p1,\n    "NAME" => v_p2\n  );');
  expect(sql.source).toContain("DBMS_OUTPUT.PUT_LINE('resultado: ' || resultado);");
  expect(splitScript(sql.source)).toHaveLength(1);
});

test("prepara un procedimiento de entrada con binds nombrados y tipos iniciales", () => {
  const draft = routineDraft(["HR", "PKG", "RUN"], {
    subprogram_id: 1, returns: null,
    parameters: [
      { declaration: { name: "FECHA", data_type: "DATE", direction: "IN" } },
      { declaration: { name: "ID", data_type: "NUMBER", direction: "IN" } },
      { declaration: { name: "NOMBRE", data_type: "VARCHAR2", direction: "IN" } },
    ],
  });
  expect(draft.source).toBe('BEGIN\n  "HR"."PKG"."RUN"(\n    "FECHA"  => :FECHA,\n    "ID"     => :ID,\n    "NOMBRE" => :NOMBRE\n  );\nEND;\n/');
  expect(draft.bindKinds).toEqual({ FECHA: "Date", ID: "Number", NOMBRE: "Text" });
});
