/*
 * Line diffs for the code diff dialog: what's the same, removed and added between two texts, with
 * each line's number on its side. Common lines at the start and end are matched first, then the
 * middle by longest common subsequence — capped, so a huge rewrite can't stall the page (past the
 * cap the middle is shown as removed, then added). Whitespace is ignored (like `git diff -w`): lines
 * differing only in spaces, tabs or indentation are the same line.
 */

export type DiffLine =
  /** `text` is the head's line, `was` the base's when it differs (in whitespace only). */
  | { type: "same"; a: number; b: number; text: string; was?: string }
  | { type: "del"; a: number; text: string }
  | { type: "add"; b: number; text: string };

/** Above this many cells (middle lines × middle lines), the middle isn't matched line by line. */
const LCS_CELLS = 4_000_000;

/** `aStart` / `bStart`: the first line's number on each side (a declaration starts mid-file). */
export function diffLines(a: string[], b: string[], aStart = 1, bStart = 1): DiffLine[] {
  // lines compared without their whitespace
  const ak = a.map(squash);
  const bk = b.map(squash);
  const same = (i: number, j: number, ai: number, bj: number): DiffLine => (a[i] === b[j] ? { type: "same", a: ai, b: bj, text: b[j]! } : { type: "same", a: ai, b: bj, text: b[j]!, was: a[i]! });
  let pre = 0;
  while (pre < a.length && pre < b.length && ak[pre] === bk[pre]) pre++;
  let post = 0;
  while (post < a.length - pre && post < b.length - pre && ak[a.length - 1 - post] === bk[b.length - 1 - post]) post++;
  const out: DiffLine[] = [];
  for (let i = 0; i < pre; i++) out.push(same(i, i, aStart + i, bStart + i));

  const am = ak.slice(pre, a.length - post);
  const bm = bk.slice(pre, b.length - post);
  const n = am.length;
  const m = bm.length;
  if (n * m > LCS_CELLS) {
    am.forEach((_, i) => out.push({ type: "del", a: aStart + pre + i, text: a[pre + i]! }));
    bm.forEach((_, j) => out.push({ type: "add", b: bStart + pre + j, text: b[pre + j]! }));
  } else if (n || m) {
    // lengths of the longest common subsequence of am[i..] and bm[j..]
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        out.push(same(pre + i, pre + j, aStart + pre + i, bStart + pre + j));
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) {
        out.push({ type: "add", b: bStart + pre + j, text: b[pre + j]! });
        j++;
      } else {
        out.push({ type: "del", a: aStart + pre + i, text: a[pre + i]! });
        i++;
      }
    }
    // removals before additions within each changed run (reads like a review tool)
    reorderRuns(out);
  }
  for (let k = 0; k < post; k++) out.push(same(a.length - post + k, b.length - post + k, aStart + a.length - post + k, bStart + b.length - post + k));
  return out;
}

/** A line without its whitespace: what lines are compared by. */
const squash = (line: string) => line.replace(/\s+/g, "");

function reorderRuns(lines: DiffLine[]) {
  let k = 0;
  while (k < lines.length) {
    if (lines[k]!.type === "same") {
      k++;
      continue;
    }
    let end = k;
    while (end < lines.length && lines[end]!.type !== "same") end++;
    const run = lines.slice(k, end);
    lines.splice(k, run.length, ...run.filter((l) => l.type === "del"), ...run.filter((l) => l.type === "add"));
    k = end;
  }
}

export type SplitRow = { left?: Extract<DiffLine, { type: "same" | "del" }>; right?: Extract<DiffLine, { type: "same" | "add" }> };

/** Side by side: same lines on both sides; in a changed run, removed lines beside added ones. */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let k = 0;
  while (k < lines.length) {
    const l = lines[k]!;
    if (l.type === "same") {
      rows.push({ left: l, right: l });
      k++;
      continue;
    }
    const dels: Extract<DiffLine, { type: "del" }>[] = [];
    const adds: Extract<DiffLine, { type: "add" }>[] = [];
    while (k < lines.length && lines[k]!.type !== "same") {
      const x = lines[k]!;
      if (x.type === "del") dels.push(x);
      else if (x.type === "add") adds.push(x);
      k++;
    }
    for (let r = 0; r < Math.max(dels.length, adds.length); r++) rows.push({ left: dels[r], right: adds[r] });
  }
  return rows;
}

/** Long runs of unchanged lines are folded to `context` lines around each change. */
export type Folded<T> = { type: "rows"; rows: T[] } | { type: "fold"; count: number };
export function foldUnchanged<T>(rows: T[], changed: (row: T) => boolean, context = 3): Folded<T>[] {
  const keep = rows.map(() => false);
  rows.forEach((r, i) => {
    if (!changed(r)) return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Folded<T>[] = [];
  let i = 0;
  while (i < rows.length) {
    const start = i;
    const kept = keep[i];
    while (i < rows.length && keep[i] === kept) i++;
    // a fold only when it hides enough to be worth it
    if (kept || i - start <= 2) out.push({ type: "rows", rows: rows.slice(start, i) });
    else out.push({ type: "fold", count: i - start });
  }
  return out;
}
