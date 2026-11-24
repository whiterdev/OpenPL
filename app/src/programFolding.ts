import { foldService } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { programFoldRanges } from "./programStructure";

type Fold = { from: number; to: number };
const documents = new WeakMap<Text, Map<number, Fold>>();

export const programFolding = foldService.of(({ doc }, lineStart) => {
  let folds = documents.get(doc);
  if (!folds) {
    folds = new Map();
    for (const { opening, closing } of programFoldRanges(doc.toString())) {
      const line = doc.lineAt(opening);
      const from = line.to;
      const to = doc.lineAt(closing).from - 1;
      if (to > from && to > (folds.get(line.from)?.to ?? 0)) folds.set(line.from, { from, to });
    }
    documents.set(doc, folds);
  }
  return folds.get(lineStart) ?? null;
});
