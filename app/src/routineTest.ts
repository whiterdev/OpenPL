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

export function routineDraft(path: string[], signature: RoutineOverload): string {
  const declarations: string[] = [];
  const outputs: string[] = [];
  const variables = signature.parameters.map(({ declaration }, index) => {
    const variable = `p${index + 1}`;
    if (!declaration.name) throw new Error("Argumento sin nombre en la firma.");
    addVariable(variable, declaration, declaration.direction !== "OUT", declaration.direction !== "IN");
    return `${identifier(declaration.name)} => ${variable}`;
  });
  if (signature.returns) addVariable("resultado", signature.returns.declaration, false, true);
  const call = `${signature.returns ? "resultado := " : ""}${path.map(identifier).join(".")}(${variables.join(", ")});`;
  return [...(declarations.length ? ["DECLARE", ...declarations] : []), "BEGIN", `  ${call}`, ...outputs, "END;", "/"].join("\n");

  function addVariable(name: string, argument: RoutineArgument["declaration"], input: boolean, output: boolean) {
    const type = scalarTypes.get(argument.data_type);
    if (!type) throw new Error(`Tipo sin plantilla de prueba: ${argument.data_type}`);
    const bind = type === "BOOLEAN" ? `(:${name} = 1)` : `:${name}`;
    declarations.push(`  ${name} ${type}${input ? ` := ${bind}` : ""};`);
    const value = type === "BOOLEAN" ? `CASE WHEN ${name} THEN 'TRUE' WHEN NOT ${name} THEN 'FALSE' END` : name;
    if (output) outputs.push(`  DBMS_OUTPUT.PUT_LINE('${name}: ' || ${value});`);
  }
}
