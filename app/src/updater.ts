import { isTauri } from "@tauri-apps/api/core";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface AvailableUpdate {
  version: string;
  notes: string;
  install(onProgress?: (pct: number | null) => void): Promise<void>;
}

export interface Updater {
  check(): Promise<AvailableUpdate | null>;
}

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "upToDate" }
  | { kind: "error"; message: string }
  | { kind: "installing"; pct: number | null };

export type DownloadProgress = { total: number | null; done: number };

export function applyDownloadEvent(p: DownloadProgress, e: DownloadEvent): DownloadProgress {
  if (e.event === "Started") return { total: e.data.contentLength ?? null, done: 0 };
  if (e.event === "Progress") return { ...p, done: p.done + e.data.chunkLength };
  return p;
}

export function progressPct(p: DownloadProgress): number | null {
  if (!p.total) return null;
  return Math.min(100, Math.round((p.done / p.total) * 100));
}

export async function runCheck(u: Updater, silent: boolean): Promise<UpdateState> {
  try {
    const update = await u.check();
    return update ? { kind: "available", update } : { kind: "upToDate" };
  } catch {
    return silent ? { kind: "idle" } : { kind: "error", message: "No se pudo buscar actualizaciones" };
  }
}

// Único lugar que usa los plugins de actualización y reinicio.
export const tauriUpdater: Updater = {
  async check() {
    if (!isTauri()) return null;
    const found = await check();
    if (!found) return null;
    return {
      version: found.version,
      notes: found.body ?? "",
      async install(onProgress) {
        let progress: DownloadProgress = { total: null, done: 0 };
        await found.downloadAndInstall((e) => {
          progress = applyDownloadEvent(progress, e);
          onProgress?.(progressPct(progress));
        });
        // En Windows el instalador cierra la app; en el resto hay que reiniciar.
        await relaunch();
      },
    };
  },
};
