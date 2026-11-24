// Envoltorios tipados de los comandos Tauri.
import { invoke, isTauri } from "@tauri-apps/api/core";
import * as tauriClipboard from "@tauri-apps/plugin-clipboard-manager";
import type { EditorReference } from "./editorReference";
import type { RoutineOverload, TestOutputBind } from "./routineTest";
import type {
  ClientInfo,
  CompletionObject,
  CompletionScope,
  BindValue,
  ExecOutcome,
  ExplainPlan,
  QueryPage,
  EditTarget,
  RowChange,
  ApplyResult,
  ConnectParams,
  ConnectResult,
  ConnectionProfile,
  ObjectInfo,
  ObjectColumn,
  ObjectType,
  ProgramPart,
  Scope,
  SessionState,
} from "./types";

export const api = {
  routineOverloads: (sessionId: string, owner: string, packageName: string | null, name: string) =>
    invoke<RoutineOverload[]>("routine_overloads", { sessionId, owner, package: packageName, name }),
  clientInfo: () => invoke<ClientInfo>("client_info"),
  setClientDir: (dir: string | null) => invoke<void>("set_client_dir", { dir }),
  listProfiles: () => invoke<ConnectionProfile[]>("list_profiles"),
  saveProfile: (profile: ConnectionProfile, password: string | null) =>
    invoke<void>("save_profile", { profile, password }),
  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),
  storedPassword: (id: string) =>
    invoke<string | null>("stored_password", { id }),
  connect: (params: ConnectParams) =>
    invoke<ConnectResult>("connect", { params }),
  disconnect: (sessionId: string) => invoke<void>("disconnect", { sessionId }),
  reconnect: (sessionId: string) => invoke<void>("reconnect", { sessionId }),
  sessionState: (sessionId: string) =>
    invoke<SessionState>("session_state", { sessionId }),
  listObjects: (
    sessionId: string,
    scope: Scope,
    objectType: ObjectType,
    filter: string | null,
  ) =>
    invoke<ObjectInfo[]>("list_objects", {
      sessionId,
      scope,
      objectType,
      filter,
    }),
  objectDdl: (
    sessionId: string,
    objectType: ObjectType,
    owner: string,
    name: string,
  ) => invoke<string>("object_ddl", { sessionId, objectType, owner, name }),
  programSource: (
    sessionId: string,
    objectType: ObjectType,
    owner: string,
    name: string,
  ) =>
    invoke<ProgramPart[]>("program_source", {
      sessionId,
      objectType,
      owner,
      name,
    }),
  editorObject: (
    sessionId: string,
    reference: EditorReference,
    contextOwner: string | null,
  ) =>
    invoke<ObjectInfo | null>("editor_object", {
      sessionId,
      ...reference,
      contextOwner,
    }),
  describeColumns: (sessionId: string, owner: string, name: string) =>
    invoke<ObjectColumn[]>("describe_columns", { sessionId, owner, name }),
  completeObjects: (
    sessionId: string,
    owner: string | null,
    prefix: string,
    contextOwner: string | null,
    scope?: CompletionScope,
  ) =>
    invoke<CompletionObject[]>("complete_objects", {
      sessionId,
      owner,
      prefix,
      contextOwner,
      scope: scope ?? null,
    }),
  objectColumns: (
    sessionId: string,
    owner: string | null,
    name: string,
    contextOwner: string | null,
  ) =>
    invoke<ObjectColumn[]>("object_columns", {
      sessionId,
      owner,
      name,
      contextOwner,
    }),
  sqlOpen: (sessionId: string) => invoke<string>("sql_open", { sessionId }),
  sqlClose: (sessionId: string) => invoke<void>("sql_close", { sessionId }),
  sqlExecute: (
    sessionId: string,
    sql: string,
    binds: BindValue[],
    pageSize?: number,
    testOutputs?: TestOutputBind[],
  ) =>
    invoke<ExecOutcome>("sql_execute", {
      sessionId,
      sql,
      binds,
      pageSize: pageSize ?? null,
      testOutputs: testOutputs ?? null,
    }),
  sqlFetch: (sessionId: string, cursor: number, size?: number) =>
    invoke<QueryPage>("sql_fetch", { sessionId, cursor, size: size ?? null }),
  sqlExplain: (sessionId: string, sql: string) => invoke<ExplainPlan>("sql_explain", { sessionId, sql }),
  sqlCancel: (sessionId: string) =>
    invoke<boolean>("sql_cancel", { sessionId }),
  sqlCommit: (sessionId: string) =>
    invoke<boolean>("sql_commit", { sessionId }),
  sqlRollback: (sessionId: string) =>
    invoke<boolean>("sql_rollback", { sessionId }),
  sqlEditTarget: (sessionId: string, owner: string | null, name: string) =>
    invoke<EditTarget | null>("sql_edit_target", { sessionId, owner, name }),
  sqlApply: (sessionId: string, target: EditTarget, changes: RowChange[]) =>
    invoke<ApplyResult>("sql_apply", { sessionId, target, changes }),
  openProgramFile: () =>
    invoke<{ name: string; source: string } | null>("open_program_file"),
  saveProgramFile: (source: string, extension: string, name: string | null) =>
    invoke<string | null>("save_program_file", { source, extension, name }),
  recompile: (
    sessionId: string,
    objectType: ObjectType,
    owner: string,
    name: string,
  ) =>
    invoke<{ with_errors: boolean }>("recompile", {
      sessionId,
      objectType,
      owner,
      name,
    }),
};

// En el navegador (vite dev sin Tauri) no existe el plugin.
export const clipboard = {
  readText: (): Promise<string> =>
    isTauri() ? tauriClipboard.readText() : navigator.clipboard.readText(),
  writeText: (text: string): Promise<void> =>
    isTauri() ? tauriClipboard.writeText(text) : navigator.clipboard.writeText(text),
};
