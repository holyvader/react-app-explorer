import type { DiffLine } from "../lib/lineDiff.ts";
import type { Coloured } from "../lib/nodeDiff.ts";
import type { TokLine } from "../lib/syntax.ts";
import "./syntax.css";
import "./nodeDiff.css";

/*
 * What the code diff dialog and the tooltip's diff column share (with `useColoured`, lib/nodeDiff.ts):
 * a line's code, and an inline row (line numbers, − / +, code). Plain HTML: files can be long.
 */

/** A line's code: coloured when its side was, else as text. */
export function DiffCode({ tokens, text }: { tokens?: TokLine; text: string }) {
  if (!tokens) return <>{text || " "}</>;
  if (!tokens.length) return <> </>;
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={`rae-tok--${t.k}`}>
          {t.t}
        </span>
      ))}
    </>
  );
}

/** One line of an inline diff (inside `.rae-cdiff[data-mode="inline"]`): base and head line numbers, the sign, the code. */
export function InlineRow({ line: l, coloured }: { line: DiffLine; coloured: Coloured }) {
  return (
    <tr data-type={l.type}>
      <td className="rae-cdiff__num">{l.type !== "add" ? l.a : ""}</td>
      <td className="rae-cdiff__num">{l.type !== "del" ? l.b : ""}</td>
      <td className="rae-cdiff__sign">{l.type === "add" ? "+" : l.type === "del" ? "−" : ""}</td>
      <td className="rae-cdiff__code">
        <DiffCode tokens={l.type === "del" ? coloured.before?.[l.a - 1] : coloured.after?.[l.b - 1]} text={l.text} />
      </td>
    </tr>
  );
}
