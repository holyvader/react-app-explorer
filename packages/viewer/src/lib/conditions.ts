import type { Condition } from "@rae/schema";

/** Human-readable form of a single render condition: "when <this> holds". */
export function formatCondition(c: Condition): string {
  switch (c.kind) {
    case "and":
    case "or":
    case "ternary-true":
    case "if":
    case "switch-case":
      return c.expr;
    case "ternary-false":
    case "early-return":
      return negate(c.expr);
    case "map":
      return `each of ${c.expr}`;
    case "render-prop":
      return `render prop ${c.expr}`;
    case "prop":
      return `as prop "${c.expr}"`;
    case "suspense":
      return `inside <Suspense>${c.expr ? ` (fallback ${c.expr})` : ""}`;
    case "error-boundary":
      return `inside <${c.expr}>`;
  }
}

function negate(expr: string): string {
  if (/^!\((.*)\)$/.test(expr)) return expr.slice(2, -1);
  if (/^![\w.$]+$/.test(expr)) return expr.slice(1);
  if (/^[\w.$]+$/.test(expr)) return `!${expr}`;
  return `!(${expr})`;
}

export const CONDITION_LABEL: Record<Condition["kind"], string> = {
  and: "&&",
  or: "||",
  "ternary-true": "? :",
  "ternary-false": "? :",
  if: "if",
  "early-return": "guard",
  "switch-case": "case",
  map: "map",
  "render-prop": "fn",
  prop: "prop",
  suspense: "suspense",
  "error-boundary": "boundary",
};

export function summarize(conds: Condition[] | undefined, max = 42): string | undefined {
  if (!conds?.length) return undefined;
  const s = conds.map(formatCondition).join(" ∧ ");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
