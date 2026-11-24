import type { BindKind } from "./types";

interface RoutineArgument {
  declaration: {
    name: string | null;
    data_type: string;
    direction: string | null;
    defaulted?: boolean;
    type_owner?: string | null;
    type_name?: string | null;
    type_subname?: string | null;
  };
}

export interface RoutineOverload {
  subprogram_id: number;
  parameters: RoutineArgument[];
  returns: RoutineArgument | null;
}

export interface TestOutputBind {
  name: string;
  label: string;
  kind: "Text" | "Number" | "Date" | "Timestamp" | "Clob" | "Cursor";
}

export interface TestRoutine {
  path: string[];
  signature: RoutineOverload;
  overloaded: boolean;
}

const scalarTypes = new Map([
  ["VARCHAR2", "VARCHAR2(32767)"], ["CHAR", "CHAR(32767)"],
  ["NUMBER", "NUMBER"], ["DATE", "DATE"], ["PLS_INTEGER", "PLS_INTEGER"],
  ["BINARY_INTEGER", "BINARY_INTEGER"], ["BOOLEAN", "BOOLEAN"],
  ["PL/SQL BOOLEAN", "BOOLEAN"], ["TIMESTAMP", "TIMESTAMP"],
  ["CLOB", "CLOB"], ["REF CURSOR", "SYS_REFCURSOR"],
]);
// Oracle 12c SQL and PL/SQL reserved words.
const reserved = new Set(`ACCESS ADD ALL ALTER AND ANY AS ASC AT AUDIT BEGIN BETWEEN BY CASE CHAR CHECK
  CLUSTER CLUSTERS COLAUTH COLUMN COLUMNS COMMENT COMPRESS CONNECT CRASH CREATE CURRENT CURSOR DATE
  DECIMAL DECLARE DEFAULT DELETE DESC DISTINCT DROP ELSE END EXCEPTION EXCLUSIVE EXISTS FETCH FILE FLOAT
  FOR FROM FUNCTION GOTO GRANT GROUP HAVING IDENTIFIED IF IMMEDIATE IN INCREMENT INDEX INDEXES INITIAL
  INSERT INTEGER INTERSECT INTO IS LEVEL LIKE LOCK LONG MAXEXTENTS MINUS MODE MODIFY NOAUDIT NOCOMPRESS
  NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE OPTION OR ORDER OVERLAPS PCTFREE PRIOR PRIVILEGES PROCEDURE
  PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET SHARE SIZE SMALLINT SQL START
  SUBTYPE SUCCESSFUL SYNC TABAUTH TABLE THEN TO TRIGGER TYPE UID UNION UNIQUE UPDATE USER VALIDATE VALUES
  VARCHAR VARCHAR2 VIEW VIEWS WHEN WHENEVER WHERE WITH`.split(/\s+/));
const ordinary = (name: string) => /^[A-Z][A-Z0-9_$#]*$/.test(name) && !reserved.has(name);
const identifier = (name: string) => ordinary(name) ? name : `"${name.replace(/"/g, '""')}"`;

function outputKind(type: string): TestOutputBind["kind"] {
  switch (type) {
    case "NUMBER":
    case "PLS_INTEGER":
    case "BINARY_INTEGER": return "Number";
    case "DATE": return "Date";
    case "TIMESTAMP": return "Timestamp";
    case "CLOB": return "Clob";
    case "SYS_REFCURSOR": return "Cursor";
    default: return "Text";
  }
}

export function routineDraft(path: string[], signature: RoutineOverload, overloaded = false, omitted: number[] = []) {
  const declarations: string[] = [];
  const assignments: string[] = [];
  const outputSql: string[] = [];
  const outputs: TestOutputBind[] = [];
  const optional: { index: number; label: string }[] = [];
  const bindKinds: Record<string, BindKind> = {};
  const names = signature.parameters.map(({ declaration }) => declaration.name?.toUpperCase());
  const unique = (seed: string) => {
    let name = seed;
    while (names.includes(name)) name += "_";
    return name;
  };
  const parameters = signature.parameters.flatMap(({ declaration }, index) => {
    const { name, data_type, direction, defaulted } = declaration;
    if (!name) throw new Error("Argumento sin nombre en la firma.");
    if (defaulted && direction === "IN") {
      optional.push({ index, label: name });
      if (omitted.includes(index)) return [];
    }
    const type = scalarTypes.get(data_type);
    const variable = `v_p${index + 1}`;
    if (!type) {
      declarations.push(`  ${variable} ${namedType(declaration)};`);
      if (direction !== "OUT") assignments.push(`  -- Completar ${variable} antes de ejecutar.`);
      return [{ name: identifier(name), expression: variable }];
    }
    if (type === "SYS_REFCURSOR" && direction !== "OUT") {
      declarations.push(`  ${variable} SYS_REFCURSOR;`);
      assignments.push(`  -- Abrir ${variable} antes de ejecutar.`);
      if (direction !== "IN") addOutput(index, variable, type, name);
      return [{ name: identifier(name), expression: variable }];
    }
    const normal = name.toUpperCase();
    const bindName = normal.length <= 30 && ordinary(normal) && names.indexOf(normal) === index
      ? normal : unique(`ARG_${index + 1}`);
    const bind = `:${bindName}`;
    if (!overloaded && direction === "OUT" && ["DATE", "TIMESTAMP", "NUMBER", "VARCHAR2(32767)", "CLOB", "SYS_REFCURSOR"].includes(type)) {
      outputs.push({ name: bindName, label: name, kind: outputKind(type) });
      return [{ name: identifier(name), expression: bind }];
    }
    if (direction !== "OUT") {
      bindKinds[bindName] = type === "DATE" || type === "TIMESTAMP" ? "Date"
        : ["VARCHAR2(32767)", "CHAR(32767)", "CLOB"].includes(type) ? "Text" : "Number";
    }
    if (!overloaded && direction === "IN" && ["DATE", "TIMESTAMP", "NUMBER", "VARCHAR2(32767)"].includes(type)) {
      return [{ name: identifier(name), expression: bind }];
    }
    const input = direction === "OUT" ? "" : ` := ${type === "BOOLEAN" ? `(${bind} = 1)` : bind}`;
    declarations.push(`  ${variable} ${type}${input};`);
    if (direction !== "IN") addOutput(index, variable, type, name);
    return [{ name: identifier(name), expression: variable }];
  });
  let resultTarget = "";
  if (signature.returns) {
    const declaration = signature.returns.declaration;
    const type = scalarTypes.get(declaration.data_type);
    if (type && type !== "BOOLEAN") {
      const name = unique("RESULTADO");
      outputs.push({ name, label: "Retorno", kind: outputKind(type) });
      resultTarget = `:${name} := `;
    } else {
      declarations.push(`  resultado ${type ?? namedType(declaration)};`);
      if (type) addOutput(signature.parameters.length, "resultado", type, "Retorno");
      resultTarget = "resultado := ";
    }
  }
  const width = Math.max(0, ...parameters.map(({ name }) => name.length));
  const argumentsSql = parameters.map(({ name, expression }) => `    ${name.padEnd(width)} => ${expression}`);
  const call = `${resultTarget}${path.map(identifier).join(".")}${
    argumentsSql.length ? `(\n${argumentsSql.join(",\n")}\n  )` : ""
  };`;
  return {
    source: [...(declarations.length ? ["DECLARE", ...declarations] : []), "BEGIN",
      ...assignments, `  ${call}`, ...outputSql, "END;", "/"].join("\n"),
    bindKinds, optional, outputs,
  };

  function addOutput(index: number, variable: string, type: string, label: string) {
    const name = unique(`OPENPL_SALIDA_${index + 1}`);
    const kind = outputKind(type);
    const expression = type === "BOOLEAN" ? `CASE WHEN ${variable} THEN 'TRUE' WHEN NOT ${variable} THEN 'FALSE' END` : variable;
    outputs.push({ name, label, kind });
    outputSql.push(`  :${name} := ${expression};`);
  }
}

function namedType({ type_owner, type_name, type_subname, data_type }: RoutineArgument["declaration"]) {
  if (!type_name) throw new Error(`Tipo sin plantilla de prueba: ${data_type}`);
  return [type_owner, type_name, type_subname].filter((part): part is string => !!part).map(identifier).join(".");
}
