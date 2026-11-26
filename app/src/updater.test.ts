import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  applyDownloadEvent,
  progressPct,
  runCheck,
  tauriUpdater,
  type AvailableUpdate,
  type Updater,
} from "./updater";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

class FakeUpdater implements Updater {
  constructor(private result: AvailableUpdate | null | Error) {}
  check(): Promise<AvailableUpdate | null> {
    return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
  }
}

const update: AvailableUpdate = { version: "1.0.0", notes: "Arreglos", install: () => Promise.resolve() };

describe("runCheck", () => {
  it("sin versión nueva queda al día", async () => {
    expect(await runCheck(new FakeUpdater(null), false)).toEqual({ kind: "upToDate" });
  });

  it("con versión nueva la ofrece con versión y notas", async () => {
    const state = await runCheck(new FakeUpdater(update), true);
    expect(state.kind).toBe("available");
    if (state.kind !== "available") return;
    expect(state.update.version).toBe("1.0.0");
    expect(state.update.notes).toBe("Arreglos");
  });

  it("en modo silencioso un error vuelve a idle", async () => {
    expect(await runCheck(new FakeUpdater(new Error("sin red")), true)).toEqual({ kind: "idle" });
  });

  it("en modo manual un error se informa", async () => {
    const state = await runCheck(new FakeUpdater(new Error("sin red")), false);
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.message).toContain("No se pudo buscar actualizaciones");
  });
});

describe("progreso de descarga", () => {
  it("calcula el porcentaje con el tamaño total", () => {
    let p = applyDownloadEvent({ total: null, done: 0 }, { event: "Started", data: { contentLength: 200 } });
    p = applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 50 } });
    expect(progressPct(p)).toBe(25);
    p = applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 150 } });
    expect(progressPct(p)).toBe(100);
  });

  it("sin tamaño total el porcentaje es null", () => {
    let p = applyDownloadEvent({ total: null, done: 0 }, { event: "Started", data: {} });
    p = applyDownloadEvent(p, { event: "Progress", data: { chunkLength: 50 } });
    expect(progressPct(p)).toBeNull();
  });
});

describe("tauriUpdater", () => {
  beforeEach(() => {
    vi.mocked(check).mockReset();
    vi.mocked(relaunch).mockReset();
  });

  it("fuera de Tauri no busca y devuelve null", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await tauriUpdater.check()).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it("sin versión nueva devuelve null", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(check).mockResolvedValue(null);
    expect(await tauriUpdater.check()).toBeNull();
  });

  it("instala informando el progreso y reinicia", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const downloadAndInstall = vi.fn(async (onEvent?: (e: unknown) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Finished" });
    });
    vi.mocked(check).mockResolvedValue({ version: "1.0.0", body: "Notas", downloadAndInstall } as never);

    const found = await tauriUpdater.check();
    expect(found?.version).toBe("1.0.0");
    expect(found?.notes).toBe("Notas");

    const seen: (number | null)[] = [];
    await found?.install((pct) => seen.push(pct));
    expect(seen).toContain(40);
    expect(relaunch).toHaveBeenCalled();
  });

  it("sin notas usa texto vacío", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(check).mockResolvedValue({ version: "1.0.0", downloadAndInstall: vi.fn() } as never);
    expect((await tauriUpdater.check())?.notes).toBe("");
  });
});
