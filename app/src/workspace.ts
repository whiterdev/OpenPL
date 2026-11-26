import type { ObjectInfo, Workspace, WorkspaceTab } from "./types";

interface WorkspaceCandidate {
  id: string;
  label: string;
  workspaceProfileId?: string;
  connection?: { profileId?: string };
  object?: Pick<ObjectInfo, "owner" | "name" | "object_type">;
  sql?: { initial: string; test?: unknown; command?: boolean };
  parts?: readonly { source: string }[];
  fileName?: string;
}

export function captureWorkspace(
  tabs: readonly WorkspaceCandidate[],
  profileId: string,
  documents: ReadonlyMap<string, { toString(): string }>,
): Workspace {
  const saved: WorkspaceTab[] = [];
  for (const tab of tabs) {
    if ((tab.connection?.profileId ?? tab.workspaceProfileId) !== profileId || tab.sql?.command) continue;
    if (tab.object) {
      const { owner, name, object_type } = tab.object;
      saved.push({ type: "object", owner, name, object_type });
    } else if (tab.sql) {
      const text = documents.get(tab.id)?.toString() ?? tab.sql.initial;
      saved.push({ type: "sql", title: tab.label, text, kind: tab.sql.test ? "test" : "sql" });
    } else if (tab.fileName && tab.parts?.length) {
      const text = documents.get(tab.id)?.toString() ?? tab.parts[0].source;
      saved.push({ type: "file", name: tab.fileName, text });
    }
  }
  return { version: 1, tabs: saved };
}

export function validateWorkspace(data: unknown): Workspace | null {
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const { version, tabs } = data as Record<string, unknown>;
  if (version !== 1 || !Array.isArray(tabs) || tabs.length > 50) return null;
  const programs = ["Package", "Type", "Procedure", "Function", "Trigger"];
  const saved: WorkspaceTab[] = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const value of tabs as unknown[]) {
    if (!value || typeof value !== "object") return null;
    const tab = value as Record<string, unknown>;
    if (tab.type === "object" && typeof tab.owner === "string" && typeof tab.name === "string" &&
        typeof tab.object_type === "string" && programs.includes(tab.object_type)) {
      saved.push({ type: "object", owner: tab.owner, name: tab.name, object_type: tab.object_type as ObjectInfo["object_type"] });
      continue;
    }
    if (typeof tab.text !== "string") return null;
    bytes += encoder.encode(tab.text).length;
    if (bytes > 2 * 1024 * 1024) return null;
    if (tab.type === "file" && typeof tab.name === "string") {
      saved.push({ type: "file", name: tab.name, text: tab.text });
    } else if (tab.type === "sql" && typeof tab.title === "string" && (tab.kind === "sql" || tab.kind === "test")) {
      saved.push({ type: "sql", title: tab.title, text: tab.text, kind: tab.kind });
    } else return null;
  }
  return { version: 1, tabs: saved };
}
