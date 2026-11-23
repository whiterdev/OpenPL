import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionBar } from "./ConnectionBar";
import type { ActiveConnection } from "../types";

const dev: ActiveConnection = {
  sessionId: "s1",
  label: "HR en DEV",
  environment: "dev",
  serverVersion: "12.1.0",
  compat: { kind: "Supported" },
};
const prod: ActiveConnection = { ...dev, sessionId: "s2", label: "VENTAS en PROD", environment: "prod" };

describe("ConnectionBar", () => {
  test("muestra la franja del entorno de la conexión activa", () => {
    render(
      <ConnectionBar connections={[dev, prod]} activeId="s2" states={{}} onSelect={vi.fn()} onDisconnect={vi.fn()} onReconnect={vi.fn()} />,
    );
    const activa = screen.getByRole("button", { name: /VENTAS en PROD/ });
    expect(activa.querySelector(".stripe")?.closest(".env-prod")).not.toBeNull();
  });

  test("estado desconectado muestra Reconectar", async () => {
    const onReconnect = vi.fn();
    render(
      <ConnectionBar connections={[dev]} activeId="s1" states={{ s1: "Disconnected" }} onSelect={vi.fn()} onDisconnect={vi.fn()} onReconnect={onReconnect} />,
    );
    expect(screen.getByText("Desconectado")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reconectar" }));
    expect(onReconnect).toHaveBeenCalledWith("s1");
  });

  test("advertencia de compatibilidad se indica con su texto en el tooltip", () => {
    const warn = { ...dev, compat: { kind: "Warn" as const, reason: "Instant Client 12 no está probado" } };
    render(<ConnectionBar connections={[warn]} activeId="s1" states={{}} onSelect={vi.fn()} onDisconnect={vi.fn()} onReconnect={vi.fn()} />);
    expect(screen.getByTitle("Instant Client 12 no está probado")).toBeInTheDocument();
  });

  test("elegir otra conexión del desplegable llama onSelect", async () => {
    const onSelect = vi.fn();
    render(<ConnectionBar connections={[dev, prod]} activeId="s1" states={{}} onSelect={onSelect} onDisconnect={vi.fn()} onReconnect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /HR en DEV/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /VENTAS en PROD/ }));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });
});
