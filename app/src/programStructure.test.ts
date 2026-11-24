import { expect, test } from "vitest";
import { programStructure } from "./programStructure";

test("distingue globales de locales y recupera el siguiente miembro después de bloques anidados", () => {
  const source = `CREATE OR REPLACE PACKAGE BODY PKG_VENTAS AS
    g_total NUMBER := 0;
    "Mi Constante" CONSTANT VARCHAR2(40) := q'[PROCEDURE fantasma;]';
    TYPE t_fila IS RECORD (id NUMBER);
    PROCEDURE registrar(p_id IN NUMBER) IS
      l_total NUMBER;
      PROCEDURE interno IS
      BEGIN
        NULL;
      END;
    BEGIN
      FOR i IN 1 .. 3 LOOP
        IF i = 1 THEN
          l_total := CASE WHEN i = 1 THEN 1 ELSE 0 END;
        END IF;
      END LOOP;
    END registrar;
    g_estado VARCHAR2(20);
  BEGIN
    DECLARE
      l_inicial NUMBER;
    BEGIN NULL; END;
  END PKG_VENTAS;`;
  const outline = programStructure(source);
  expect(outline.map(({ label }) => label)).toEqual([
    "g_total", '"Mi Constante"', "t_fila", "registrar(p_id IN NUMBER)", "g_estado",
  ]);
  expect(outline[1].from).toBe(source.indexOf('"Mi Constante"'));
});

test("empareja firmas públicas aunque los encabezados tengan valores por defecto", () => {
  const spec = programStructure(`PACKAGE PKG_VENTAS AS
    PROCEDURE registrar(
      p_id IN NUMBER DEFAULT fn(1, 2),
      p_fecha DATE
    );
    FUNCTION calcular(p_id NUMBER) RETURN NUMBER;
    CURSOR filas(p_id NUMBER) RETURN t_fila;
  END;`);
  const body = programStructure(`PACKAGE BODY PKG_VENTAS AS
    PROCEDURE registrar(p_id NUMBER, p_fecha DATE) IS BEGIN NULL; END;
    PROCEDURE registrar(p_id VARCHAR2, p_fecha DATE) IS BEGIN NULL; END;
    FUNCTION calcular(p_id NUMBER) RETURN NUMBER IS BEGIN RETURN 1; END;
    CURSOR filas(p_id NUMBER) RETURN t_fila IS SELECT 1 FROM dual;
  END;`);
  expect(spec.map((entry) => entry.label)).toEqual([
    "registrar(p_id IN NUMBER, p_fecha DATE)", "calcular(p_id NUMBER) RETURN NUMBER", "filas(p_id NUMBER) RETURN t_fila",
  ]);
  expect(body.map((entry) => spec.some(({ key }) => key === entry.key))).toEqual([true, false, true, true]);
});

test("incluye la rutina independiente y excluye sus declaraciones locales", () => {
  expect(programStructure(`CREATE OR REPLACE PROCEDURE HR.procesar(p_ref NUMBER) IS
    l_temp VARCHAR2(1);
    PROCEDURE local IS BEGIN NULL; END;
  BEGIN NULL; END;`).map((entry) => entry.label)).toEqual(["procesar(p_ref NUMBER)"]);
});

test("un SELECT con un nombre que parece tipo no se interpreta como un programa", () => {
  expect(programStructure("SELECT type, columna FROM catalogo;")).toEqual([]);
});

test("una declaración adelantada navega a la implementación cuando está disponible", () => {
  const source = `PACKAGE BODY PKG_VENTAS AS
    PROCEDURE registrar(p_id NUMBER);
    PROCEDURE registrar(p_id NUMBER) IS
    BEGIN
      CASE p_id WHEN 1 THEN NULL; ELSE NULL; END CASE;
    END;
    ultima BOOLEAN;
  END;`;
  const outline = programStructure(source);
  expect(outline.map(({ label }) => label)).toEqual(["registrar(p_id NUMBER)", "ultima"]);
  expect(outline[0].from).toBe(source.lastIndexOf("registrar"));
});
