import { expect, test } from "vitest";
import { routineDraft } from "./routineTest";
import { splitScript } from "./sqlScript";

test("prepara un procedimiento sin argumentos en un solo bloque", () => {
  const sql = routineDraft(["HR", "PKG", "RUN"], { subprogram_id: 1, parameters: [], returns: null });
  expect(sql.source).toBe("BEGIN\n  HR.PKG.RUN;\nEND;\n/");
  expect(splitScript(sql.source)).toHaveLength(1);
});

test("una función NUMBER sin argumentos asigna directamente a un bind numérico", () => {
  const draft = routineDraft(["HR", "PKG", "GET_TOTAL"], {
    subprogram_id: 1,
    parameters: [],
    returns: { declaration: { name: null, data_type: "NUMBER", direction: "OUT" } },
  });
  expect(draft.source).toBe("BEGIN\n  :RESULTADO := HR.PKG.GET_TOTAL;\nEND;\n/");
  expect(draft.outputs).toEqual([{ name: "RESULTADO", label: "Retorno", kind: "Number" }]);
});

test("conserva comillas en palabras reservadas y nombres sensibles a mayúsculas", () => {
  const draft = routineDraft(["HR", "Mi Paquete", "SELECT"], { subprogram_id: 1, parameters: [], returns: null });
  expect(draft.source).toContain('HR."Mi Paquete"."SELECT";');
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
  expect(sql.source).toContain(":RESULTADO := HR.PKG.READ(\n    ID   => v_p1,\n    NAME => v_p2\n  );");
  expect(sql.outputs).toEqual([
    { name: "OPENPL_SALIDA_2", label: "NAME", kind: "Text" },
    { name: "RESULTADO", label: "Retorno", kind: "Number" },
  ]);
  expect(splitScript(sql.source)).toHaveLength(1);
});

test("omite solo argumentos opcionales y describe salidas de cursor y tipos compuestos", () => {
  const draft = routineDraft(["HR", "PKG", "RUN"], {
    subprogram_id: 1, returns: null,
    parameters: [
      { declaration: { name: "ID", data_type: "NUMBER", direction: "IN", defaulted: true } },
      { declaration: { name: "REC", data_type: "PL/SQL RECORD", direction: "IN",
        type_owner: "HR", type_name: "PKG", type_subname: "ROW_T" } },
      { declaration: { name: "FILAS", data_type: "REF CURSOR", direction: "OUT" } },
    ],
  }, false, [0, 1]);
  expect(draft.optional).toEqual([{ index: 0, label: "ID" }]);
  expect(draft.source).not.toContain(":ID");
  expect(draft.source).toContain("v_p2 HR.PKG.ROW_T;");
  expect(draft.source).toContain("FILAS => :FILAS");
  expect(draft.outputs).toEqual([{ name: "FILAS", label: "FILAS", kind: "Cursor" }]);
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
  expect(draft.source).toBe("BEGIN\n  HR.PKG.RUN(\n    FECHA  => :FECHA,\n    ID     => :ID,\n    NOMBRE => :NOMBRE\n  );\nEND;\n/");
  expect(draft.bindKinds).toEqual({ FECHA: "Date", ID: "Number", NOMBRE: "Text" });
});
