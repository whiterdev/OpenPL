// Envoltorios tipados de los comandos Tauri.
import { invoke } from "@tauri-apps/api/core";
import type { EditorReference } from "./editorReference";
import type {
  ClientInfo,
  CompletionObject,
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
  clientInfo: () => invoke<ClientInfo>("client_info"),
  setClientDir: (dir: string | null) => invoke<void>("set_client_dir", { dir }),
  listProfiles: () => invoke<ConnectionProfile[]>("list_profiles"),
  saveProfile: (profile: ConnectionProfile, password: string | null) =>
    invoke<void>("save_profile", { profile, password }),
  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),
  storedPassword: (id: string) => invoke<string | null>("stored_password", { id }),
  connect: (params: ConnectParams) => invoke<ConnectResult>("connect", { params }),
  disconnect: (sessionId: string) => invoke<void>("disconnect", { sessionId }),
  reconnect: (sessionId: string) => invoke<void>("reconnect", { sessionId }),
  sessionState: (sessionId: string) => invoke<SessionState>("session_state", { sessionId }),
  listObjects: (sessionId: string, scope: Scope, objectType: ObjectType, filter: string | null) =>
    invoke<ObjectInfo[]>("list_objects", { sessionId, scope, objectType, filter }),
  objectDdl: (sessionId: string, objectType: ObjectType, owner: string, name: string) =>
    invoke<string>("object_ddl", { sessionId, objectType, owner, name }),
  programSource: (sessionId: string, objectType: ObjectType, owner: string, name: string) =>
    invoke<ProgramPart[]>("program_source", { sessionId, objectType, owner, name }),
  editorObject: (sessionId: string, reference: EditorReference, contextOwner: string | null) =>
    invoke<ObjectInfo | null>("editor_object", { sessionId, ...reference, contextOwner }),
  describeColumns: (sessionId: string, owner: string, name: string) =>
    invoke<ObjectColumn[]>("describe_columns", { sessionId, owner, name }),
  completeObjects: (sessionId: string, owner: string | null, prefix: string, contextOwner: string | null) =>
    invoke<CompletionObject[]>("complete_objects", { sessionId, owner, prefix, contextOwner }),
  objectColumns: (sessionId: string, owner: string | null, name: string, contextOwner: string | null) =>
    invoke<ObjectColumn[]>("object_columns", { sessionId, owner, name, contextOwner }),
  openProgramFile: () => invoke<{ name: string; source: string } | null>("open_program_file"),
  saveProgramFile: (source: string, extension: string, name: string | null) =>
    invoke<string | null>("save_program_file", { source, extension, name }),
  recompile: (sessionId: string, objectType: ObjectType, owner: string, name: string) =>
    invoke<{ with_errors: boolean }>("recompile", { sessionId, objectType, owner, name }),
};
