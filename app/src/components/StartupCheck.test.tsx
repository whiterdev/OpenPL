import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartupCheck } from "./StartupCheck";
import { api } from "../api";

vi.mock("../api", () => ({ api: { clientInfo: vi.fn(), setClientDir: vi.fn() } }));
const m = vi.mocked(api);

const missing = {
  version: null,
  error: { code: "DPI-1047", kind: "ClientMissing" as const, message: "No se encontró Oracle Instant Client (64 bits)." },
  help: "Agregue su carpeta al PATH",
  lib_dir: null,
};

describe("StartupCheck", () => {
  beforeEach(() => vi.resetAllMocks());

  test("sin Instant Client muestra error y ayuda, y botón Reintentar", async () => {
    m.clientInfo.mockResolvedValue(missing);
    render(<StartupCheck onReady={vi.fn()} />);
    expect(await screen.findByText("DPI-1047")).toBeInTheDocument();
    expect(screen.getByText("Agregue su carpeta al PATH")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(m.clientInfo).toHaveBeenCalledTimes(2);
  });

  test("elegir carpeta del cliente llama setClientDir y pide reiniciar", async () => {
    m.clientInfo.mockResolvedValue(missing);
    m.setClientDir.mockResolvedValue(undefined);
    render(<StartupCheck onReady={vi.fn()} />);
    await userEvent.type(await screen.findByLabelText("Carpeta del cliente"), "C:\\oracle\\ic19");
    await userEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(m.setClientDir).toHaveBeenCalledWith("C:\\oracle\\ic19");
    expect(await screen.findByText("Reinicie OpenPL")).toBeInTheDocument();
  });

  test("con cliente llama onReady", async () => {
    const info = { version: "19.21.0", error: null, help: "", lib_dir: null };
    m.clientInfo.mockResolvedValue(info);
    const onReady = vi.fn();
    render(<StartupCheck onReady={onReady} />);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(info));
  });
});
