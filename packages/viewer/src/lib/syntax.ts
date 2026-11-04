/*
 * Syntax colours and layout for code shown in the viewer, without a parser library:
 * - `layoutType`: a TypeScript type as the checker prints it (one long line) laid out like an
 *   editor would — on one line when it fits, else objects, parameter lists and long unions broken
 *   one entry per line — with `| undefined` dropped from optional members (`x?: T | undefined`).
 * - `lexSource`: TS / TSX source as written (definitions, the code diff), coloured as is.
 * Tokens carry a kind the renderers map to the `syntax.*` colours.
 */

export type TokKind = "keyword" | "primitive" | "type" | "name" | "literal" | "punct" | "comment" | "tag" | "attr" | "fn" | "plain";
export interface Tok {
  k: TokKind;
  t: string;
}
export type TokLine = Tok[];

const PRIMITIVES = new Set(["string", "number", "boolean", "bigint", "symbol", "null", "undefined", "void", "any", "unknown", "never", "object", "true", "false", "this"]);
const TYPE_KEYWORDS = new Set(["keyof", "typeof", "readonly", "infer", "extends", "is", "asserts", "unique", "new", "in", "as", "const", "abstract", "out", "import", "declare"]);
const SOURCE_KEYWORDS = new Set([
  ...TYPE_KEYWORDS,
  "await", "async", "break", "case", "catch", "class", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "finally",
  "for", "from", "function", "get", "if", "implements", "instanceof", "interface", "let", "module", "namespace", "of", "private", "protected",
  "public", "return", "satisfies", "set", "static", "super", "switch", "throw", "try", "type", "var", "while", "with", "yield",
]);

const STRING = /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y;
const NUMBER = /-?\b(?:0[xob][\da-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)n?\b/iy;
const IDENT = /[A-Za-z_$][\w$]*/y;
const SPACE = /[ \t]+/y;
const PUNCT = /=>|\.\.\.|\?\.|\?\?=?|[=!]==?|&&=?|\|\|=?|[<>]=?|[-+*/%^&|!~?:;,.=@#{}()[\]]/y;

function at(re: RegExp, text: string, i: number): string | undefined {
  re.lastIndex = i;
  const m = re.exec(text);
  return m && m.index === i && m[0] ? m[0] : undefined;
}

// ---- types --------------------------------------------------------------------------------

/** A type's tokens: identifiers as keywords, primitives, member / parameter names or type names. */
export function lexType(text: string): Tok[] {
  const toks: Tok[] = [];
  for (let i = 0; i < text.length; ) {
    const s = at(SPACE, text, i) ?? (text[i] === "\n" ? "\n" : undefined);
    if (s) {
      toks.push({ k: "plain", t: s === "\n" ? " " : s });
      i += s.length;
      continue;
    }
    const tpl = text[i] === "`" ? templateEnd(text, i) : -1;
    const str = tpl >= 0 ? text.slice(i, tpl) : at(STRING, text, i);
    if (str) {
      toks.push({ k: "literal", t: str });
      i += str.length;
      continue;
    }
    const num = at(NUMBER, text, i);
    if (num && !/[\w$]/.test(text[i - 1] ?? "")) {
      toks.push({ k: "literal", t: num });
      i += num.length;
      continue;
    }
    const id = at(IDENT, text, i);
    if (id) {
      toks.push({ k: PRIMITIVES.has(id) ? "primitive" : TYPE_KEYWORDS.has(id) ? "keyword" : "type", t: id });
      i += id.length;
      continue;
    }
    const p = at(PUNCT, text, i) ?? text[i]!;
    toks.push({ k: "punct", t: p });
    i += p.length;
  }
  // member and parameter names: an identifier right before `:` or `?:`, not the `: ` of a conditional type
  for (let j = 0; j < toks.length; j++) {
    const tk = toks[j]!;
    if (tk.k !== "type" && tk.k !== "primitive" && tk.k !== "keyword") continue;
    let n = j + 1;
    while (toks[n]?.k === "plain") n++;
    if (toks[n]?.t === "?") n++;
    if (toks[n]?.t !== ":") continue;
    let p = j - 1;
    while (toks[p]?.k === "plain") p--;
    const before = toks[p]?.t;
    if (before === undefined || before === "{" || before === ";" || before === "," || before === "(" || before === "readonly" || before === "...") tk.k = "name";
  }
  return toks;
}

/** A bracketed part of a type: `{ … }`, `( … )`, `[ … ]`, `< … >`, its entries split at `;` / `,`. */
interface Group {
  open: Tok;
  close?: Tok;
  items: Seq[];
}
type El = Tok | Group;
type Seq = El[];
const isGroup = (e: El): e is Group => "items" in e;
const CLOSE: Record<string, string> = { "{": "}", "(": ")", "[": "]", "<": ">" };

function parseType(toks: Tok[]): Seq {
  let i = 0;
  const seq = (close?: string): Seq[] => {
    const items: Seq[] = [[]];
    while (i < toks.length) {
      const tk = toks[i]!;
      if (close && tk.t === close) return items;
      i++;
      if (tk.k === "punct" && CLOSE[tk.t]) {
        const open = tk;
        const inner = seq(CLOSE[tk.t]);
        const end = toks[i]?.t === CLOSE[tk.t] ? toks[i++] : undefined;
        items.at(-1)!.push({ open, close: end, items: inner });
      } else if (close && (tk.t === ";" || tk.t === ",")) items.push([]);
      else items.at(-1)!.push(tk);
    }
    return items;
  };
  return seq()[0]!;
}

const trim = (s: Seq): Seq => {
  let a = 0;
  let b = s.length;
  while (a < b && !isGroup(s[a]!) && (s[a] as Tok).k === "plain") a++;
  while (b > a && !isGroup(s[b - 1]!) && (s[b - 1] as Tok).k === "plain") b--;
  return s.slice(a, b);
};
const isBlank = (s: Seq) => trim(s).length === 0;

/** The parts of a sequence split at top-level `sep` tokens (`|`, `&`). */
function splitAt(s: Seq, sep: string): Seq[] {
  const parts: Seq[] = [[]];
  for (const e of s) {
    if (!isGroup(e) && e.k === "punct" && e.t === sep) parts.push([]);
    else parts.at(-1)!.push(e);
  }
  return parts;
}

/** `x?: T | undefined` → `x?: T`: TypeScript adds the `undefined` every optional member already implies. */
function dropOptionalUndefined(item: Seq): Seq {
  const t = trim(item);
  const colon = t.findIndex((e) => !isGroup(e) && e.t === ":");
  if (colon < 1) return item;
  const q = t[colon - 1]!;
  if (isGroup(q) || q.t !== "?") return item;
  const members = splitAt(t.slice(colon + 1), "|");
  const kept = members.filter((m) => {
    const x = trim(m);
    return !(x.length === 1 && !isGroup(x[0]!) && x[0]!.t === "undefined");
  });
  if (kept.length === members.length || !kept.length) return item;
  const value: Seq = [{ k: "plain", t: " " }];
  kept.forEach((m, n) => {
    if (n) value.push({ k: "plain", t: " " }, { k: "punct", t: "|" }, { k: "plain", t: " " });
    value.push(...trim(m));
  });
  return [...t.slice(0, colon + 1), ...value];
}

function cleanGroups(s: Seq, dropUndefined: boolean): Seq {
  return s.map((e) => {
    if (!isGroup(e)) return e;
    const items = e.items.map((it) => cleanGroups(dropUndefined && (e.open.t === "{" || e.open.t === "(") ? dropOptionalUndefined(it) : it, dropUndefined));
    return { ...e, items: items.filter((it, n) => !(isBlank(it) && n === items.length - 1 && items.length > 1)) };
  });
}

const SEP: Record<string, string> = { "{": ";", "(": ",", "[": ",", "<": "," };

function flatLen(s: Seq): number {
  let n = 0;
  for (const e of s) n += isGroup(e) ? groupFlatLen(e) : e.t.length;
  return n;
}
function groupFlatLen(g: Group): number {
  const items = g.items.map(trim).filter((it) => it.length);
  if (!items.length) return g.open.t.length + (g.close?.t.length ?? 0);
  const pad = g.open.t === "{" ? 2 : 0;
  return g.open.t.length + pad + items.reduce((n, it) => n + flatLen(it), 0) + (items.length - 1) * 2 + (g.close?.t.length ?? 0);
}

class Printer {
  lines: TokLine[] = [[]];
  col = 0;
  constructor(readonly width: number, readonly start: number) {
    this.col = start;
  }
  emit(t: Tok) {
    this.lines.at(-1)!.push(t);
    this.col += t.t.length;
  }
  newline(indent: number) {
    this.lines.push(indent ? [{ k: "plain", t: "  ".repeat(indent) }] : []);
    this.col = indent * 2;
  }
  get atLineStart() {
    return this.lines.at(-1)!.every((t) => t.k === "plain" && !t.t.trim());
  }
}

function printSeq(p: Printer, s: Seq, indent: number) {
  // a member or parameter (`name?: value`): its name, then its value laid out on its own
  const colon = s.findIndex((e) => !isGroup(e) && e.t === ":");
  if (colon > 0 && s.slice(0, colon).every((e) => !isGroup(e) && (e.k === "name" || e.t === "?" || e.k === "plain" || e.t === "readonly" || e.t === "..."))) {
    for (const e of s.slice(0, colon + 1)) if (!(e as Tok).t.trim() && p.atLineStart) continue;
    else p.emit(e as Tok);
    printSeq(p, s.slice(colon + 1), indent);
    return;
  }
  // a long union of simple members (literals, names): one member per line, each after a `|`
  const members = splitAt(s, "|");
  const simple = members.filter((m) => !trim(m).some(isGroup)).length;
  if (members.length >= 3 && simple >= members.length - 1 && p.col + flatLen(s) > p.width) {
    const fresh = p.atLineStart;
    const inner = fresh ? indent : indent + 1;
    let first = true;
    for (const m of members) {
      if (isBlank(m)) continue;
      if (!(first && fresh)) p.newline(inner);
      first = false;
      p.emit({ k: "punct", t: "| " });
      printSeq(p, trim(m), inner);
    }
    return;
  }
  for (let k = 0; k < s.length; k++) {
    const e = s[k]!;
    if (!isGroup(e)) {
      if (e.k === "plain" && p.atLineStart) continue; // no spaces where a line starts
      p.emit(e);
      continue;
    }
    // what follows up to the next group stays on this line too (`) => void`, `} | undefined`)
    let rest = 0;
    for (let r = k + 1; r < s.length && !isGroup(s[r]!); r++) rest += (s[r] as Tok).t.length;
    if (p.col + groupFlatLen(e) + rest <= p.width) printFlat(p, e);
    else printBroken(p, e, indent);
  }
}

function printFlat(p: Printer, g: Group) {
  const items = g.items.map(trim).filter((it) => it.length);
  p.emit({ ...g.open, k: "punct" });
  if (items.length && g.open.t === "{") p.emit({ k: "plain", t: " " });
  items.forEach((it, n) => {
    if (n) p.emit({ k: "punct", t: `${SEP[g.open.t]} ` });
    for (const e of it) if (isGroup(e)) printFlat(p, e);
    else p.emit(e);
  });
  if (items.length && g.open.t === "{") p.emit({ k: "plain", t: " " });
  if (g.close) p.emit({ ...g.close, k: "punct" });
}

function printBroken(p: Printer, g: Group, indent: number) {
  const items = g.items.map(trim).filter((it) => it.length);
  // a single bracketed entry hugs its brackets: `Promise<{` … `}>`
  const only = items.length === 1 && items[0]!.length === 1 && isGroup(items[0]![0]!) ? (items[0]![0] as Group) : undefined;
  p.emit({ ...g.open, k: "punct" });
  if (only) {
    printBroken(p, only, indent);
    if (g.close) p.emit({ ...g.close, k: "punct" });
    return;
  }
  items.forEach((it, n) => {
    p.newline(indent + 1);
    printSeq(p, it, indent + 1);
    if (g.open.t === "{") p.emit({ k: "punct", t: ";" });
    else if (n < items.length - 1) p.emit({ k: "punct", t: "," });
  });
  p.newline(indent);
  if (g.close) p.emit({ ...g.close, k: "punct" });
}

export interface LayoutOptions {
  /** Characters a line may take. */
  width?: number;
  /** Characters already used on the first line (a prop name before its type). */
  start?: number;
  /** One line, whatever its length (chips, short previews). */
  flat?: boolean;
  /** Keep `| undefined` on optional members (source as written: the author put it there). */
  keepUndefined?: boolean;
  /** The type of an optional prop / parameter shown on its own (`x?:` is outside the text): drop its `| undefined` too. */
  optional?: boolean;
}

/** A type laid out as lines of coloured tokens (see the file's header). */
export function layoutType(text: string, { width = 60, start = 0, flat = false, keepUndefined = false, optional = false }: LayoutOptions = {}): TokLine[] {
  let tree = cleanGroups(parseType(lexType(text.trim())), !keepUndefined);
  if (optional && !keepUndefined) {
    // as if it were `x?: <type>`: the same rule as for members
    const asMember: Seq = [{ k: "name", t: "x" }, { k: "punct", t: "?" }, { k: "punct", t: ":" }, { k: "plain", t: " " }, ...tree];
    tree = dropOptionalUndefined(asMember).slice(3);
  }
  const p = new Printer(flat ? Infinity : Math.max(20, width), start);
  printSeq(p, trim(tree), 0);
  return p.lines.filter((l, n) => n === 0 || l.length);
}

/** The layout as plain text (tests, copying). */
export const typeLines = (text: string, opts?: LayoutOptions) => layoutType(text, opts).map((l) => l.map((t) => t.t).join(""));

// ---- source -------------------------------------------------------------------------------

function templateEnd(text: string, i: number): number {
  let depth = 0;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === "\\") j++;
    else if (c === "$" && text[j + 1] === "{") {
      depth++;
      j++;
    } else if (c === "}" && depth) depth--;
    else if (c === "`" && !depth) return j + 1;
  }
  return text.length;
}

/**
 * TS / TSX source as lines of coloured tokens: comments, strings (template literals too, across
 * lines), numbers, keywords, primitives, types (capitalised names), called functions, JSX tags and
 * attributes. Lexical only: good for reading, not a parser.
 */
export function lexSource(text: string): TokLine[] {
  const lines: TokLine[] = [[]];
  const push = (k: TokKind, t: string) => {
    const parts = t.split("\n");
    parts.forEach((part, n) => {
      if (n) lines.push([]);
      if (part) lines.at(-1)!.push({ k, t: part });
    });
  };
  let inTag = false; // between `<Name` and its `>`: identifiers are attributes (outside `{…}`)
  let tagBraces = 0;
  let prevSig = ""; // the last significant token, to tell JSX `<` from a comparison
  for (let i = 0; i < text.length; ) {
    const c = text[i]!;
    if (c === "\n" || c === " " || c === "\t" || c === "\r") {
      let j = i;
      while (j < text.length && /[ \t\r\n]/.test(text[j]!)) j++;
      push("plain", text.slice(i, j).replace(/\r/g, ""));
      i = j;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const j = text.indexOf("\n", i);
      push("comment", text.slice(i, j < 0 ? text.length : j));
      i = j < 0 ? text.length : j;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const j = text.indexOf("*/", i + 2);
      const end = j < 0 ? text.length : j + 2;
      push("comment", text.slice(i, end));
      i = end;
      continue;
    }
    if (c === "`") {
      const end = templateEnd(text, i);
      push("literal", text.slice(i, end));
      i = end;
      prevSig = "`";
      continue;
    }
    const str = at(STRING, text, i);
    if (str) {
      push("literal", str);
      i += str.length;
      prevSig = '"';
      continue;
    }
    const num = at(NUMBER, text, i);
    if (num && !/[\w$]/.test(text[i - 1] ?? "")) {
      push("literal", num);
      i += num.length;
      prevSig = "0";
      continue;
    }
    // JSX: `<Name`, `</Name`, `<>` after something that can't end an expression
    if (c === "<" && (SOURCE_KEYWORDS.has(prevSig) || !/[\w$)\]]$/.test(prevSig))) {
      const m = /^<\/?([A-Za-z][\w.:-]*)?/.exec(text.slice(i, i + 80));
      if (m && (m[1] || text[i + 1] === ">" || text[i + 1] === "/")) {
        push("punct", m[0].slice(0, m[0].length - (m[1]?.length ?? 0)));
        if (m[1]) push("tag", m[1]);
        i += m[0].length;
        inTag = true;
        tagBraces = 0;
        prevSig = "<";
        continue;
      }
    }
    const id = at(IDENT, text, i);
    if (id) {
      let k: TokKind;
      if (inTag && !tagBraces) k = "attr";
      else if (PRIMITIVES.has(id)) k = "primitive";
      else if (SOURCE_KEYWORDS.has(id)) k = "keyword";
      else if (/^[A-Z]/.test(id)) k = "type";
      else if (/^\s*(?:<[^>]*>)?\s*\(/.test(text.slice(i + id.length, i + id.length + 40)) && prevSig !== ".") k = "fn";
      else k = "plain";
      push(k, id);
      i += id.length;
      prevSig = id;
      continue;
    }
    const p = at(PUNCT, text, i) ?? c;
    if (inTag) {
      if (p === "{") tagBraces++;
      else if (p === "}" && tagBraces) tagBraces--;
      else if (p === ">" && !tagBraces) inTag = false;
    }
    push("punct", p);
    i += p.length;
    prevSig = p;
  }
  return lines;
}

// ---- definitions --------------------------------------------------------------------------

/** A member (`readonly name?: …;`) or a one-line alias (`export type X<T> = …;`): its indent, lead-in, type and `;`. */
const MEMBER = /^(\s*)((?:readonly\s+)?[\w$]+\??\s*:\s*|(?:export\s+)?(?:declare\s+)?type\s+[\w$]+(?:<[^=]*>)?\s*=\s*)(.+?)(;?)\s*$/;

/**
 * A definition as written (interface, type alias, enum), coloured, with each line that's too long
 * — a member or alias written on one line — laid out like a type is: objects and parameters
 * broken one entry per line under the member. Lines that fit, comments and what's already
 * spread over lines stay as written; so does `| undefined` the author wrote.
 */
export function layoutDefinition(text: string, width: number): TokLine[] {
  const raw = text.split("\n");
  const coloured = lexSource(text);
  const out: TokLine[] = [];
  raw.forEach((line, n) => {
    const toks = coloured[n] ?? [];
    const comment = toks.every((t) => t.k === "comment" || !t.t.trim());
    const m = !comment && line.length > width ? MEMBER.exec(line) : null;
    if (!m || !/[{(|<]/.test(m[3]!)) {
      out.push(toks);
      return;
    }
    const [, indent, lead, value, semi] = m as unknown as [string, string, string, string, string];
    const head = lexSource(indent + lead)[0] ?? [];
    const laid = layoutType(value, { width: width - indent.length, start: lead.length, keepUndefined: true });
    laid.forEach((l, k) => {
      const last = k === laid.length - 1;
      const tail: Tok[] = last && semi ? [{ k: "punct", t: semi }] : [];
      out.push(k === 0 ? [...head, ...l, ...tail] : [{ k: "plain", t: indent }, ...l, ...tail]);
    });
  });
  return out;
}
