// Tipos espejo de los structs Rust (serde por defecto).

export type Role = "Normal" | "SysDba" | "SysOper";
export type Environment = "dev" | "qa" | "prod";

export interface ConnectionProfile {
  id: string;
  name: string;
  user: string;
  db: string;
  role: Role;
  environment: Environment | null;
  save_password: boolean;
}

export interface ConnectParams {
  user: string;
  password: string;
  db: string;
  role: Role;
}

export type ErrorKind =
  | "ClientMissing"
  | "InvalidCredentials"
  | "PasswordExpired"
  | "AccountLocked"
  | "UnknownService"
  | "Timeout"
  | "ConnectionLost"
  | "Other";

export interface DbError {
  code: string | null;
  kind: ErrorKind;
  message: string;
  /** Posición del error en la sentencia (base 0). */
  offset?: number | null;
}

export type BindKind = "Text" | "Number" | "Date";

export interface BindValue {
  name: string;
  value: string | null;
  kind: BindKind;
}

export interface SqlColumn {
  name: string;
  type_name: string;
  numeric: boolean;
  lob: boolean;
}

export interface QueryPage {
  rows: (string | null)[][];
  more: boolean;
}

export type ExecResult =
  | { kind: "Query"; cursor: number; columns: SqlColumn[]; page: QueryPage }
  | { kind: "Failed"; error: DbError }
  | { kind: "Done"; message: string };

export interface EditColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  editable: boolean;
}

export interface EditTarget {
  owner: string;
  name: string;
  columns: EditColumn[];
}

export type RowChange =
  | {
      kind: "Update";
      rowid: string;
      original: Record<string, string | null>;
      values: Record<string, string | null>;
    }
  | { kind: "Delete"; rowid: string; original: Record<string, string | null> }
  | { kind: "Insert"; values: Record<string, string | null> };

export interface Conflict {
  index: number;
  reason: "Locked" | "Changed" | "Missing";
  current: Record<string, string | null> | null;
}

export type ApplyResult =
  | {
      kind: "Applied";
      updated: number;
      deleted: number;
      inserted: string[];
      transaction: boolean;
    }
  | { kind: "Conflicts"; conflicts: Conflict[] };

export interface ExecOutcome {
  result: ExecResult;
  elapsed_ms: number;
  output: string[];
  transaction: boolean;
  test_outputs?: TestOutput[];
}

export interface ExplainPlan {
  columns: SqlColumn[];
  page: QueryPage;
}

export type TestOutput = { name: string } & (
  | { kind: "Scalar"; value: string | null }
  | { kind: "Cursor"; columns: SqlColumn[]; page: QueryPage }
  | { kind: "Error"; message: string }
);

export type CoreError =
  | { Io: string }
  | { Json: string }
  | { Secret: string }
  | { Db: DbError }
  | "SessionNotFound"
  | "Disconnected";

export type Compat =
  | { kind: "Supported" }
  | { kind: "Warn"; reason: string }
  | { kind: "Unsupported"; reason: string };

export type SessionState = "Connected" | "Disconnected";

export interface ClientInfo {
  version: string | null;
  error: DbError | null;
  help: string;
  lib_dir: string | null;
}

export interface ConnectResult {
  session_id: string;
  server_version: string;
  compat: Compat;
}

export type ObjectType =
  | "Package"
  | "Procedure"
  | "Function"
  | "Trigger"
  | "Type"
  | "JavaSource"
  | "JavaClass"
  | "DbmsJob"
  | "Queue"
  | "QueueTable"
  | "Library"
  | "Directory"
  | "Table"
  | "Index"
  | "Constraint"
  | "View"
  | "MaterializedView"
  | "Sequence"
  | "User"
  | "Profile"
  | "Role"
  | "Synonym"
  | "DatabaseLink"
  | "Tablespace"
  | "Cluster"
  | "WindowGroup"
  | "Window"
  | "Schedule"
  | "Program"
  | "Chain"
  | "Job"
  | "JobClass"
  | "Credential"
  | "FileWatcher"
  | "RecycleBin";

export type Scope = "Mine" | "All";
export type ObjectStatus = "Valid" | "Invalid";

export interface ObjectInfo {
  owner: string;
  name: string;
  object_type: ObjectType;
  status: ObjectStatus;
  last_ddl_time: string;
}

export interface ActiveConnection {
  sessionId: string;
  label: string;
  environment: Environment | null;
  serverVersion: string;
  compat: Compat;
}

export type WorkspaceTab =
  | { type: "object"; object_type: ObjectType; owner: string; name: string }
  | { type: "sql"; title: string; text: string; kind: "sql" | "test" }
  | { type: "file"; name: string; text: string };

export interface Workspace {
  version: 1;
  tabs: WorkspaceTab[];
}

export interface ProgramPart {
  kind: string;
  source: string;
  last_ddl_time: string | null;
  diagnostics: {
    line: number;
    column: number;
    text: string;
    warning: boolean;
  }[];
}

/** "relations" limita el completado a tablas, vistas, vistas materializadas y sinónimos. */
export type CompletionScope = "any" | "relations" | "edit";

export interface CompletionObject {
  owner: string;
  name: string;
  /** Tipo tal como lo devuelve ALL_OBJECTS: TABLE, VIEW, SYNONYM... */
  object_type: string;
}

export interface ObjectColumn {
  name: string;
  data_type: string;
  nullable: boolean;
}

/** Normaliza un CoreError a código + mensaje para mostrar. */
export function describeError(e: unknown): {
  code: string | null;
  kind: ErrorKind | null;
  message: string;
  offset?: number | null;
} {
  if (e === "SessionNotFound")
    return { code: null, kind: null, message: "La sesión no existe." };
  if (e === "Disconnected")
    return {
      code: null,
      kind: "ConnectionLost",
      message: "Sesión desconectada.",
    };
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (o.Db && typeof o.Db === "object") {
      const d = o.Db as DbError;
      return {
        code: d.code,
        kind: d.kind,
        message: d.message,
        offset: d.offset ?? null,
      };
    }
    for (const k of ["Io", "Json", "Secret"])
      if (typeof o[k] === "string")
        return { code: null, kind: null, message: o[k] as string };
  }
  return { code: null, kind: null, message: String(e) };
}
