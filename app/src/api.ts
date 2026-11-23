// Envoltorios tipados de los comandos Tauri.
import { invoke } from "@tauri-apps/api/core";
import type {
  ClientInfo,
  ConnectParams,
  ConnectResult,
  ConnectionProfile,
  ObjectInfo,
  ObjectType,
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
};
