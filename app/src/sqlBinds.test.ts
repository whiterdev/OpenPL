import { expect, test } from "vitest";
import { applySubstitutions, findVariables } from "./sqlBinds";

test("encuentra binds y sustituciones sin repetir y en orden", () => {
  expect(
    findVariables(
      "select :id, :Nombre from t where a = :ID and b = &ciudad and c = &&ciudad",
    ),
  ).toEqual([
    { kind: "bind", name: "id", key: "ID" },
    { kind: "bind", name: "Nombre", key: "NOMBRE" },
    { kind: "subst", name: "ciudad", key: "CIUDAD" },
  ]);
});

test("ignora asignaciones, literales, comentarios y fechas con hora", () => {
  const source =
    "begin x := ':no'; -- :tampoco\n /* &nada */ y := to_date('10:30', 'HH24:MI'); end;";
  expect(findVariables(source)).toEqual([]);
});

test("un CREATE no lleva binds (:new y :old de triggers)", () => {
  expect(
    findVariables(
      "create or replace trigger t before insert on x for each row begin :new.a := 1; end;",
    ),
  ).toEqual([]);
});

test("sustituye &x y &&x por su valor tal cual, sin tocar literales", () => {
  expect(
    applySubstitutions("select '&no' from &tabla where id = &&id", {
      TABLA: "hr.ventas",
      ID: "7",
    }),
  ).toBe("select '&no' from hr.ventas where id = 7");
});
