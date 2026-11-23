import "@testing-library/jest-dom/vitest";

// jsdom no calcula geometría para las selecciones que dibuja CodeMirror.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => document.createElement("span").getClientRects();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
