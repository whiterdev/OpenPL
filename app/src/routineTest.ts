import type { BindKind } from "./types";

interface RoutineArgument {
  declaration: { name: string | null; data_type: string; direction: string | null };
}

export interface RoutineOverload {
  subprogram_id: number;
  parameters: RoutineArgument[];
  returns: RoutineArgument | null;
}

const scalarTypes = new Map([
  ["VARCHAR2", "VARCHAR2(32767)"], ["CHAR", "CHAR(32767)"],
  ["NUMBER", "NUMBER"], ["DATE", "DATE"], ["PLS_INTEGER", "PLS_INTEGER"],
  ["BINARY_INTEGER", "BINARY_INTEGER"], ["BOOLEAN", "BOOLEAN"],
  ["PL/SQL BOOLEAN", "BOOLEAN"], ["TIMESTAMP", "TIMESTAMP"],
]);
const identifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function routineDraft(path: string[], signature: RoutineOverload, overloaded = false) {
  const declarations: string[] = [];
  const outputs: string[] = [];
  const bindKinds: Record<string, BindKind> = {};
  const names = signature.parameters.map(({ declaration }) => declaration.name?.toUpperCase());
  const parameters = signature.parameters.map(({ declaration: { name, data_type, direction } }, index) => {
    if (!name) throw new Error("Argumento sin nombre en la firma.");
    const type = scalarTypes.get(data_type);
    if (!type) throw new Error(`Tipo sin plantilla de prueba: ${data_type}`);
    const normal = name.toUpperCase();
    let bindName = normal;
    if (!/^[A-Z][A-Z0-9_$#]{0,29}$/.test(normal) || names.indexOf(normal) !== index) {
      bindName = `ARG_${index + 1}`;
      while (names.includes(bindName)) bindName += "_";
    }
    const bind = `:${bindName}`;
    if (direction !== "OUT") {
      bindKinds[bindName] = type === "DATE" || type === "TIMESTAMP" ? "Date"
        : type === "VARCHAR2(32767)" || type === "CHAR(32767)" ? "Text" : "Number";
    }
    if (!overloaded && direction === "IN" && ["DATE", "TIMESTAMP", "NUMBER", "VARCHAR2(32767)"].includes(type)) {
      return { name: identifier(name), expression: bind };
    }
    const variable = `v_p${index + 1}`;
    addVariable(variable, type, direction === "OUT" ? null : bind, direction === "IN" ? null : name);
    return { name: identifier(name), expression: variable };
  });
  if (signature.returns) {
    const { data_type } = signature.returns.declaration;
    const type = scalarTypes.get(data_type);
    if (!type) throw new Error(`Tipo sin plantilla de prueba: ${data_type}`);
    addVariable("resultado", type, null, "resultado");
  }
  const width = Math.max(0, ...parameters.map(({ name }) => name.length));
  const argumentsSql = parameters.map(({ name, expression }) => `    ${name.padEnd(width)} => ${expression}`);
  const call = `${signature.returns ? "resultado := " : ""}${path.map(identifier).join(".")}(${
    argumentsSql.length ? `\n${argumentsSql.join(",\n")}\n  ` : ""
  });`;
  return {
    source: [...(declarations.length ? ["DECLARE", ...declarations] : []), "BEGIN", `  ${call}`, ...outputs, "END;", "/"].join("\n"),
    bindKinds,
  };

  function addVariable(name: string, type: string, bind: string | null, output: string | null) {
    const input = bind && (type === "BOOLEAN" ? `(${bind} = 1)` : bind);
    declarations.push(`  ${name} ${type}${input ? ` := ${input}` : ""};`);
    const value = type === "BOOLEAN" ? `CASE WHEN ${name} THEN 'TRUE' WHEN NOT ${name} THEN 'FALSE' END` : name;
    if (output) outputs.push(`  DBMS_OUTPUT.PUT_LINE('${output.replace(/'/g, "''")}: ' || ${value});`);
  }
}
