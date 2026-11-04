import type { Loc } from "@rae/schema";

// oxc returns ESTree nodes; we keep them loosely typed for speed of iteration.
// oxlint-disable-next-line typescript/no-explicit-any
export type N = any;

const SKIP_KEYS = new Set(["type", "start", "end", "range", "loc", "parent"]);

/** Depth-first walk. `enter` returning `false` skips children. */
export function walk(node: N, enter: (n: N, ancestors: N[]) => boolean | void, ancestors: N[] = []): void {
  if (!node || typeof node.type !== "string") return;
  if (enter(node, ancestors) === false) return;
  ancestors.push(node);
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (!v || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") walk(c, enter, ancestors);
    } else if (typeof v.type === "string") {
      walk(v, enter, ancestors);
    }
  }
  ancestors.pop();
}

export function isFunction(n: N): boolean {
  return (
    n?.type === "ArrowFunctionExpression" || n?.type === "FunctionExpression" || n?.type === "FunctionDeclaration"
  );
}

/** Strip TS wrappers and parentheses. */
export function unwrap(n: N): N {
  while (
    n &&
    (n.type === "ParenthesizedExpression" ||
      n.type === "TSAsExpression" ||
      n.type === "TSSatisfiesExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSTypeAssertion")
  ) {
    n = n.expression;
  }
  return n;
}

/** A hash of code ignoring its whitespace (like `git diff -w`): re-indenting isn't a change. */
export const codeHash = (code: string) => Bun.hash(code.replace(/\s+/g, "")).toString(36);

export class SourceText {
  private lineStarts: number[];
  constructor(readonly text: string) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    this.lineStarts = starts;
  }
  loc(offset: number): Loc {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - this.lineStarts[lo]! + 1 };
  }
  /** Where a declaration ends (line) and a hash of its source text: a diff tells changed declarations by it. */
  extent(start: number, end: number): { endLine: number; hash: string } {
    return { endLine: this.loc(Math.max(start, end - 1)).line, hash: codeHash(this.text.slice(start, end)) };
  }
  /** Source text as written (line breaks kept, common indentation removed), truncated. For previews. */
  raw(n: N, max = 4000): string {
    if (!n) return "";
    const lines = this.text.slice(n.start, n.end).split("\n");
    const indent = Math.min(...lines.slice(1).filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length), Infinity);
    const s = [lines[0], ...lines.slice(1).map((l) => (Number.isFinite(indent) ? l.slice(indent) : l))].join("\n").trimEnd();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  /** Source slice with whitespace collapsed and truncated. */
  slice(n: N, max = 160): string {
    if (!n) return "";
    const s = this.text.slice(n.start, n.end).replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }
}

export function containsJsx(n: N): boolean {
  let found = false;
  walk(n, (c) => {
    if (found) return false;
    if (c.type === "JSXElement" || c.type === "JSXFragment") {
      found = true;
      return false;
    }
  });
  return found;
}

export function memberName(n: N): string | undefined {
  if (!n) return undefined;
  if (n.type === "Identifier" || n.type === "JSXIdentifier") return n.name;
  if (n.type === "PrivateIdentifier") return "#" + n.name;
  if (n.type === "Literal" || n.type === "StringLiteral") return String(n.value);
  return undefined;
}

export const HOOK_RE = /^use[A-Z0-9]|^use$/;
