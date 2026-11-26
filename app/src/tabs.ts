export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const result = list.slice();
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function neighbor<T>(list: readonly T[], index: number, delta: number): T | undefined {
  if (!list.length) return undefined;
  return list[((index + delta) % list.length + list.length) % list.length];
}
