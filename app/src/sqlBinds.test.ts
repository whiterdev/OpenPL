import { expect, test } from "vitest";
import { applySubstitutions, findVariables } from "./sqlBinds";

test("encuentra binds y sustituciones sin repetir y en orden", () => {
  expect(
    findVariables(
      "select :id, :Nombre from t where a = :ID and b = &ciudad and c = &&ciudad",
    ),
  ).toEqual([
    { kind: "bind", name: "id", key: "ID", uses: 2 },
    { kind: "bind", name: "Nombre", key: "NOMBRE", uses: 1 },
    { kind: "subst", name: "ciudad", key: "CIUDAD", uses: 2 },
  ]);
});

test.each(["q'[L' :no &no]'", "q'{L' :no &no}'", "q'(L' :no &no)'",
  "q'<L' :no &no>'", "q'!L' :no &no!'", "nQ'[L' :no &no]'"])(
  "ignora variables dentro de %s",
  (literal) => {
    const source = `select ${literal}, :id from &tabla`;
    expect(findVariables(source).map(({ name }) => name)).toEqual(["id", "tabla"]);
    expect(applySubstitutions(source, { NO: "error", TABLA: "dual" })).toBe(
      `select ${literal}, :id from dual`,
    );
  },
);

test("cuenta usos en todo el script después de un CREATE", () => {
  const source = "create table t (id number); select :id, :ID from dual; select :id from dual;";
  expect(findVariables(source)).toEqual([{ kind: "bind", name: "id", key: "ID", uses: 3 }]);
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
