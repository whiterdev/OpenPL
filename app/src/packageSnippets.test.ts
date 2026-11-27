import { describe, expect, it } from "vitest";
import { isPackageKind, packageSnippet, packageSnippetItems } from "./packageSnippets";

describe("packageSnippets", () => {
  it("solo los paquetes tienen plantillas", () => {
    expect(isPackageKind("PACKAGE")).toBe(true);
    expect(isPackageKind("PACKAGE BODY")).toBe(true);
    expect(isPackageKind("PROCEDURE")).toBe(false);
    expect(isPackageKind("SQL")).toBe(false);
  });

  it("ofrece los seis ítems en orden", () => {
    expect(packageSnippetItems.map((item) => item.label))
      .toEqual(["Función", "Procedimiento", "Cursor", "Tipo registro", "Excepción", "Constante"]);
  });

  it.each([
    ["function", "FUNCTION nueva_funcion RETURN NUMBER;", "nueva_funcion"],
    ["procedure", "PROCEDURE nuevo_procedimiento;", "nuevo_procedimiento"],
    ["cursor", "CURSOR c_nuevo IS SELECT * FROM dual;", "c_nuevo"],
    ["record", "TYPE t_nuevo IS RECORD (\n  campo NUMBER\n);", "t_nuevo"],
    ["exception", "e_nueva EXCEPTION;", "e_nueva"],
    ["constant", "c_nueva CONSTANT NUMBER := 0;", "c_nueva"],
  ] as const)("spec: %s declara", (id, text, name) => {
    const snippet = packageSnippet("PACKAGE", id, "");
    expect(snippet.text).toBe(text);
    expect(snippet.text.slice(snippet.name.from, snippet.name.to)).toBe(name);
  });

  it("body: función y procedimiento con implementación", () => {
    expect(packageSnippet("PACKAGE BODY", "function", "").text)
      .toBe("FUNCTION nueva_funcion RETURN NUMBER IS\nBEGIN\n  RETURN NULL;\nEND nueva_funcion;");
    expect(packageSnippet("PACKAGE BODY", "procedure", "").text)
      .toBe("PROCEDURE nuevo_procedimiento IS\nBEGIN\n  NULL;\nEND nuevo_procedimiento;");
    expect(packageSnippet("PACKAGE BODY", "cursor", "").text).toBe("CURSOR c_nuevo IS SELECT * FROM dual;");
  });

  it("cada línea lleva la indentación de la línea", () => {
    const snippet = packageSnippet("PACKAGE BODY", "procedure", "    ");
    expect(snippet.text)
      .toBe("    PROCEDURE nuevo_procedimiento IS\n    BEGIN\n      NULL;\n    END nuevo_procedimiento;");
    expect(snippet.text.slice(snippet.name.from, snippet.name.to)).toBe("nuevo_procedimiento");
    expect(snippet.name.from).toBe("    PROCEDURE ".length);
  });
});
