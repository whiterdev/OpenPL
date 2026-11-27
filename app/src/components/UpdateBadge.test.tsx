import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { UpdateBadge } from "./UpdateBadge";

test("muestra la versión en su nombre y abre al hacer clic", () => {
  const onOpen = vi.fn();
  render(<UpdateBadge version="1.0.0-beta.8" onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: "Actualización disponible: 1.0.0-beta.8" }));
  expect(onOpen).toHaveBeenCalledOnce();
});
