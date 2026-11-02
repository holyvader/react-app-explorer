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
 * Lays out object types over several lines: TypeScript prints `{ title: string; subtitle?: string; }`
 * on one line. Members go one per line, indented per nesting level; strings, generics, tuples and
 * function parameters stay as they are, and `{}` stays empty.
 */
export function formatType(text: string, indent = "  "): string {
  if (!text.includes("{")) return text;
  let out = "";
  const stack: string[] = [];
  const pad = () => indent.repeat(stack.filter((b) => b === "{").length);
  const skipSpaces = (i: number) => {
    while (text[i + 1] === " ") i++;
    return i;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "{") {
      const next = text.slice(i + 1).trimStart();
      if (next.startsWith("}")) {
        out += "{}";
        i = text.indexOf("}", i);
        continue;
      }
      stack.push("{");
      out += "{\n" + pad();
      i = skipSpaces(i);
    } else if (c === "}" && stack.at(-1) === "{") {
      stack.pop();
      out = out.trimEnd() + "\n" + pad() + "}";
    } else if (c === ";" && stack.at(-1) === "{") {
      out += ";\n" + pad();
      i = skipSpaces(i);
    } else {
      if (c === "(" || c === "[" || c === "<") stack.push(c);
      else if ((c === ")" || c === "]" || (c === ">" && text[i - 1] !== "=")) && stack.length && stack.at(-1) !== "{") stack.pop();
      out += c;
    }
  }
  return out;
}
