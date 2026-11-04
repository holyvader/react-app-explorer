const IDENT = /[A-Za-z_$][\w$]*/g;
const PRIMITIVES = new Set(["string", "number", "boolean", "bigint", "symbol", "null", "undefined", "void", "any", "unknown", "never", "object", "true", "false"]);
/** String/number literals, then `|`, `&`, `[]`, `()`, `?`, `,` and spaces: what's left of a primitive-only type. */
const PRIMITIVE_REST = /^[\s|&[\](),?]*$/;

/** A type made only of primitives and literals (`string`, `number | undefined`, `"a" | "b"`, `boolean[]`): nothing to preview. */
export function isPrimitiveType(text: string): boolean {
  const rest = text
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, " ")
    .replace(/-?\b\d[\d_]*(?:\.\d+)?n?\b/g, " ")
    .replace(IDENT, (w) => (PRIMITIVES.has(w) ? " " : w));
  return PRIMITIVE_REST.test(rest);
}

/**
 * The type to show for a prop / parameter: its annotation as written when the code has one (the
 * named type the author chose: `rule: DesignedRuleInput`, `ReactElement[]`), else what the checker
 * inferred (which spells aliases out and fills default type arguments).
 */
export const shownType = (p: { type?: string; written?: string }) => p.written ?? p.type;
/** A signature's return type to show: as written when annotated, else inferred. */
export const shownReturn = (s: { returnType?: string; returnWritten?: string } | undefined) => s?.returnWritten ?? s?.returnType;
