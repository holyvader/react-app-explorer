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
