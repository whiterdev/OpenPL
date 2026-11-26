import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, clipboard } from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

const browser = { readText: vi.fn(), writeText: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("navigator", { clipboard: browser });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clipboard en Tauri", () => {
  beforeEach(() => vi.mocked(isTauri).mockReturnValue(true));

  test("readText lee con el plugin", async () => {
    vi.mocked(readText).mockResolvedValue("SELECT 1 FROM DUAL");
    await expect(clipboard.readText()).resolves.toBe("SELECT 1 FROM DUAL");
    expect(browser.readText).not.toHaveBeenCalled();
  });

  test("writeText escribe con el plugin", async () => {
    vi.mocked(writeText).mockResolvedValue(undefined);
    await clipboard.writeText("PKG_VENTAS");
    expect(writeText).toHaveBeenCalledWith("PKG_VENTAS");
    expect(browser.writeText).not.toHaveBeenCalled();
  });
});

describe("clipboard fuera de Tauri", () => {
  beforeEach(() => vi.mocked(isTauri).mockReturnValue(false));

  test("readText usa navigator.clipboard", async () => {
    browser.readText.mockResolvedValue("HR");
    await expect(clipboard.readText()).resolves.toBe("HR");
    expect(readText).not.toHaveBeenCalled();
  });

  test("writeText usa navigator.clipboard", async () => {
    browser.writeText.mockResolvedValue(undefined);
    await clipboard.writeText("HR");
    expect(browser.writeText).toHaveBeenCalledWith("HR");
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("sesiones hermanas y ping", () => {
  test("sessionSiblings y sessionPing invocan sus comandos", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["s2", "s3"]).mockResolvedValueOnce(true);
    await expect(api.sessionSiblings("s1")).resolves.toEqual(["s2", "s3"]);
    await expect(api.sessionPing("s1")).resolves.toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, "session_siblings", { sessionId: "s1" });
    expect(invoke).toHaveBeenNthCalledWith(2, "session_ping", { sessionId: "s1" });
  });
});
