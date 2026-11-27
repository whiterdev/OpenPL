// Plantillas de "Insertar" en paquetes. Sintaxis Oracle genérica; el nombre queda seleccionado para cambiarlo.

export type PackageSnippetId = "function" | "procedure" | "cursor" | "record" | "exception" | "constant";

export const packageSnippetItems: { id: PackageSnippetId; label: string }[] = [
  { id: "function", label: "Función" },
  { id: "procedure", label: "Procedimiento" },
  { id: "cursor", label: "Cursor" },
  { id: "record", label: "Tipo registro" },
  { id: "exception", label: "Excepción" },
  { id: "constant", label: "Constante" },
];

const declarations: Record<PackageSnippetId, { name: string; text: string }> = {
  function: { name: "nueva_funcion", text: "FUNCTION nueva_funcion RETURN NUMBER;" },
  procedure: { name: "nuevo_procedimiento", text: "PROCEDURE nuevo_procedimiento;" },
  cursor: { name: "c_nuevo", text: "CURSOR c_nuevo IS SELECT * FROM dual;" },
  record: { name: "t_nuevo", text: "TYPE t_nuevo IS RECORD (\n  campo NUMBER\n);" },
  exception: { name: "e_nueva", text: "e_nueva EXCEPTION;" },
  constant: { name: "c_nueva", text: "c_nueva CONSTANT NUMBER := 0;" },
};

const bodies: Partial<Record<PackageSnippetId, string>> = {
  function: "FUNCTION nueva_funcion RETURN NUMBER IS\nBEGIN\n  RETURN NULL;\nEND nueva_funcion;",
  procedure: "PROCEDURE nuevo_procedimiento IS\nBEGIN\n  NULL;\nEND nuevo_procedimiento;",
};

export function isPackageKind(kind: string) {
  return kind === "PACKAGE" || kind === "PACKAGE BODY";
}

/** Texto con la indentación en cada línea y la posición del nombre dentro de ese texto. */
export function packageSnippet(kind: string, id: PackageSnippetId, indent: string) {
  const { name } = declarations[id];
  const base = (kind === "PACKAGE BODY" && bodies[id]) || declarations[id].text;
  const text = base.split("\n").map((line) => indent + line).join("\n");
  const from = text.indexOf(name);
  return { text, name: { from, to: from + name.length } };
}
