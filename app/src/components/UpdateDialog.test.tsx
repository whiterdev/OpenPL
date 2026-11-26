import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { UpdateDialog } from "./UpdateDialog";

const update = { version: "1.0.0", notes: "Arreglos varios" };

test("muestra versión y notas, enfoca Actualizar y atrapa el foco", () => {
  const before = document.createElement("button");
  document.body.append(before);
  before.focus();
  const { unmount } = render(
    <UpdateDialog update={update} onInstall={vi.fn()} onLater={vi.fn()} />,
  );
  const dialog = screen.getByRole("dialog", { name: "OpenPL 1.0.0" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getByText("Arreglos varios")).toBeVisible();
  const install = screen.getByRole("button", { name: "Actualizar" });
  const later = screen.getByRole("button", { name: "Más tarde" });
  expect(install).toHaveFocus();
  fireEvent.keyDown(install, { key: "Tab" });
  expect(later).toHaveFocus();
  fireEvent.keyDown(later, { key: "Tab" });
  expect(install).toHaveFocus();
  fireEvent.keyDown(install, { key: "Tab", shiftKey: true });
  expect(later).toHaveFocus();
  unmount();
  expect(before).toHaveFocus();
  before.remove();
});

test("Escape y Más tarde cierran; Actualizar instala", () => {
  const onInstall = vi.fn();
  const onLater = vi.fn();
  render(<UpdateDialog update={update} onInstall={onInstall} onLater={onLater} />);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onLater).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Más tarde" }));
  expect(onLater).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
  expect(onInstall).toHaveBeenCalledOnce();
});

test("durante la descarga muestra el progreso y deshabilita los botones", () => {
  const onLater = vi.fn();
  const { rerender } = render(
    <UpdateDialog update={update} progress={null} onInstall={vi.fn()} onLater={onLater} />,
  );
  expect(screen.getByText("Descargando")).toBeVisible();
  expect(screen.getByRole("button", { name: "Actualizar" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Más tarde" })).toBeDisabled();
  rerender(<UpdateDialog update={update} progress={42} onInstall={vi.fn()} onLater={onLater} />);
  expect(screen.getByText("Descargando 42%")).toBeVisible();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(onLater).not.toHaveBeenCalled();
});

test("sin notas no muestra el bloque de notas", () => {
  render(<UpdateDialog update={{ version: "1.0.1", notes: "" }} onInstall={vi.fn()} onLater={vi.fn()} />);
  expect(document.querySelector("pre")).toBeNull();
});
