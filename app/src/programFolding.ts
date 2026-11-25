import { foldService } from "@codemirror/language";
import { MapMode, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { programFoldRanges } from "./programStructure";

type Range = { opening: number; closing: number };
type Fold = { from: number; to: number };

const RECALC_MS = 150;
const setRanges = StateEffect.define<Range[]>();

// Between recalculations ranges follow the edits; one whose keyword was deleted is dropped.
const foldRanges = StateField.define<Range[]>({
  create: (state) => programFoldRanges(state.doc.toString()),
  update(ranges, tr) {
    for (const effect of tr.effects) if (effect.is(setRanges)) return effect.value;
    if (!tr.docChanged) return ranges;
    const mapped: Range[] = [];
    for (const { opening, closing } of ranges) {
      const from = tr.changes.mapPos(opening, 1, MapMode.TrackAfter);
      const to = tr.changes.mapPos(closing, 1, MapMode.TrackAfter);
      if (from !== null && to !== null) mapped.push({ opening: from, closing: to });
    }
    return mapped;
  },
});

const recalc = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.view.dispatch({ effects: setRanges.of(programFoldRanges(this.view.state.doc.toString())) });
      }, RECALC_MS);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);

const byLine = new WeakMap<Range[], Map<number, Fold>>();

function foldsByLine(state: EditorState) {
  const ranges = state.field(foldRanges);
  let folds = byLine.get(ranges);
  if (!folds) {
    folds = new Map();
    const { doc } = state;
    for (const { opening, closing } of ranges) {
      const line = doc.lineAt(opening);
      const from = line.to;
      const to = doc.lineAt(closing).from - 1;
      if (to > from && to > (folds.get(line.from)?.to ?? 0))
        folds.set(line.from, { from, to });
    }
    byLine.set(ranges, folds);
  }
  return folds;
}

export const programFolding = [
  foldRanges,
  recalc,
  foldService.of((state, lineStart) => foldsByLine(state).get(lineStart) ?? null),
];
