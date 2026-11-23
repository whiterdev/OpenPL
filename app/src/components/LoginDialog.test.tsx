import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginDialog } from "./LoginDialog";
import { api } from "../api";
import type { ConnectionProfile } from "../types";

vi.mock("../api", () => ({
  api: {
    listProfiles: vi.fn(),
    storedPassword: vi.fn(),
    connect: vi.fn(),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
  },
}));
const m = vi.mocked(api);

const perfil: ConnectionProfile = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "HR en DEV",
  user: "HR",
  db: "db.example.com:1521/DEVPDB",
  role: "Normal",
  environment: "dev",
  save_password: true,
};

const ok = { session_id: "s1", server_version: "12.1.0", compat: { kind: "Supported" as const } };

async function llenar(user = "HR", pw = "clave", db = "DEVPDB") {
  await userEvent.type(screen.getByLabelText("Usuario"), user);
  await userEvent.type(screen.getByLabelText("Contraseña"), pw);
  await userEvent.type(screen.getByLabelText("Base de datos"), db);
}

describe("LoginDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.listProfiles.mockResolvedValue([perfil]);
    m.storedPassword.mockResolvedValue("guardada");
  });

  test("login exitoso llama onConnected con label y environment del perfil", async () => {
    m.connect.mockResolvedValue(ok);
    const onConnected = vi.fn();
    render(<LoginDialog onConnected={onConnected} />);
    await userEvent.click(await screen.findByRole("button", { name: /HR en DEV/ }));
    await userEvent.click(screen.getByRole("button", { name: /Conectar/ }));
    await vi.waitFor(() =>
      expect(onConnected).toHaveBeenCalledWith({
        sessionId: "s1",
        label: "HR en DEV",
        environment: "dev",
        serverVersion: "12.1.0",
        compat: { kind: "Supported" },
      }),
    );
  });

  test("sin perfil el label es usuario en base", async () => {
    m.listProfiles.mockResolvedValue([]);
    m.connect.mockResolvedValue(ok);
    const onConnected = vi.fn();
    render(<LoginDialog onConnected={onConnected} />);
    await llenar("HR", "x", "srv:1521/ventas");
    await userEvent.click(screen.getByRole("button", { name: /Conectar/ }));
    await vi.waitFor(() => expect(onConnected.mock.calls[0][0].label).toBe("HR en VENTAS"));
  });

  test("clave errónea muestra ORA-01017 y conserva los campos", async () => {
    m.listProfiles.mockResolvedValue([]);
    m.connect.mockRejectedValue({
      Db: { code: "ORA-01017", kind: "InvalidCredentials", message: "Usuario o contraseña incorrectos." },
    });
    render(<LoginDialog onConnected={vi.fn()} />);
    await llenar();
    await userEvent.click(screen.getByRole("button", { name: /Conectar/ }));
    expect(await screen.findByText("ORA-01017")).toBeInTheDocument();
    expect(screen.getByText("Usuario o contraseña incorrectos.")).toBeInTheDocument();
    expect(screen.getByLabelText("Usuario")).toHaveValue("HR");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
  });

  test("elegir perfil guardado completa campos y contraseña guardada", async () => {
    render(<LoginDialog onConnected={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: /HR en DEV/ }));
    expect(screen.getByLabelText("Usuario")).toHaveValue("HR");
    expect(screen.getByLabelText("Base de datos")).toHaveValue("db.example.com:1521/DEVPDB");
    await vi.waitFor(() => expect(screen.getByLabelText("Contraseña")).toHaveValue("guardada"));
  });

  test("compat Warn conecta igual y entrega la advertencia", async () => {
    m.listProfiles.mockResolvedValue([]);
    m.connect.mockResolvedValue({ ...ok, compat: { kind: "Warn", reason: "Instant Client 12 no está probado" } });
    const onConnected = vi.fn();
    render(<LoginDialog onConnected={onConnected} />);
    await llenar();
    await userEvent.click(screen.getByRole("button", { name: /Conectar/ }));
    await vi.waitFor(() => expect(onConnected.mock.calls[0][0].compat.kind).toBe("Warn"));
  });

  test("guardar perfil con Guardar contraseña desmarcado no envía password", async () => {
    m.listProfiles.mockResolvedValue([]);
    m.saveProfile.mockResolvedValue(undefined);
    render(<LoginDialog onConnected={vi.fn()} />);
    await llenar();
    await userEvent.click(screen.getByLabelText("Guardar contraseña"));
    await userEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    await vi.waitFor(() => expect(m.saveProfile).toHaveBeenCalled());
    const [p, pw] = m.saveProfile.mock.calls[0];
    expect(pw).toBeNull();
    expect(p.save_password).toBe(false);
  });

  test("Enter en el formulario conecta", async () => {
    m.listProfiles.mockResolvedValue([]);
    m.connect.mockResolvedValue(ok);
    render(<LoginDialog onConnected={vi.fn()} />);
    await llenar();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(m.connect).toHaveBeenCalledWith({ user: "HR", password: "clave", db: "DEVPDB", role: "Normal" }));
  });
});
