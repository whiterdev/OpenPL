import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "./Logo";

describe("Logo", () => {
  test("tiene nombre accesible y usa el color del texto", () => {
    render(<Logo size={18} />);
    const svg = screen.getByRole("img", { name: "OpenPL" });
    expect(svg.getAttribute("width")).toBe("18");
    expect(svg.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
  });

  test("a tamaño chico usa la versión simplificada de dos discos", () => {
    const { container, rerender } = render(<Logo size={16} />);
    expect(container.querySelectorAll("path")).toHaveLength(3);
    rerender(<Logo size={64} />);
    expect(container.querySelectorAll("path")).toHaveLength(4);
  });
});
