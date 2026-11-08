import type { GraphNode, Snapshot } from "@rae/schema";
import { IconCodeDiff } from "@rae/design-system/icons";
import { Fragment, useMemo, useState } from "react";
import { CHANGE_WORD } from "../lib/diff.ts";
import type { DiffLine } from "../lib/lineDiff.ts";
import { useNodeDiff } from "../lib/nodeDiff.ts";
import { lexSource, type TokLine } from "../lib/syntax.ts";
import "./syntax.css";
import "./nodeDiff.css";

/*
 * The diff view's "Overlay + code" mode: the node tooltip's left column, with the element's changed
 * lines only (removed − / added +, no unchanged context; runs apart), the same diff as the code diff
 * dialog (loaded once, shared), which its button opens. Plain HTML, like the rest of the tooltip.
 */

/** Files bigger than this (characters) are shown without colours, as in the dialog. */
const COLOUR_LIMIT = 400_000;

/** Runs of changed lines, each with where it starts on both sides. */
function hunksOf(lines: DiffLine[]): DiffLine[][] {
  const out: DiffLine[][] = [];
  let run: DiffLine[] | undefined;
  for (const l of lines) {
    if (l.type === "same") run = undefined;
    else (run ?? (out.push((run = [])), run)).push(l);
  }
  return out;
}

const colour = (text: string | undefined) => (text !== undefined && text.length <= COLOUR_LIMIT ? lexSource(text) : undefined);

function Code({ tokens, text }: { tokens?: TokLine; text: string }) {
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

/** Whether the column shows every line (unchanged ones too) rather than the changed ones only: remembered. */
const ALL_KEY = "rae.tipDiffAll";

/** The column: header (change, −/+ counts, all lines or changed only, the dialog's button), then the lines. */
export function TipDiff({ node, snapshot, onOpenDiff }: { node: GraphNode; snapshot: Snapshot; onOpenDiff: (node: GraphNode) => void }) {
  const change = snapshot.diff!.nodes[node.id]!;
  const { diff, error } = useNodeDiff(snapshot, node);
  const [all, setAll] = useState(() => localStorage.getItem(ALL_KEY) === "true");
  const toggleAll = () => {
    localStorage.setItem(ALL_KEY, String(!all));
    setAll(!all);
  };
  const changed = useMemo(() => (diff ? hunksOf(diff.lines) : []), [diff]);
  // every line is one run; changed only, the runs apart
  const hunks = all && diff ? [diff.lines] : changed;
  const coloured = useMemo(() => (diff ? { before: colour(diff.before), after: colour(diff.after) } : undefined), [diff]);
  return (
    <div className="rae-tip__diff">
      <div className="rae-diffcard__head">
        <span className="rae-diffcard__change" data-change={change}>
          {CHANGE_WORD[change]}
        </span>
        <span className="rae-diffcard__name">{all ? "All lines" : "Changed lines"}</span>
        {diff && (
          <span className="rae-diffcard__counts" title={`${diff.removed} line${diff.removed === 1 ? "" : "s"} removed, ${diff.added} added`}>
            <span data-type="del">−{diff.removed}</span> <span data-type="add">+{diff.added}</span>
          </span>
        )}
        {diff && changed.length > 0 && (
          <button type="button" className="rae-diffcard__toggle" aria-pressed={all} onClick={toggleAll}>
            {all ? "Changed lines only" : "Show all lines"}
          </button>
        )}
        <button type="button" className="rae-diffcard__open" aria-label="Show the code diff" title="Show the code diff" onClick={() => onOpenDiff(node)}>
          <IconCodeDiff size={14} />
        </button>
      </div>
      {error && <div className="rae-diffcard__note">Couldn't read the code: {error}</div>}
      {!diff && !error && <div className="rae-diffcard__note">Reading both versions from git…</div>}
      {diff && !changed.length && <div className="rae-diffcard__note">No lines changed in its code.</div>}
      {diff && changed.length > 0 && (
        <div className="rae-cdiff rae-diffcard__code" data-mode="inline">
          <table>
            <tbody>
              {hunks.map((h, i) => (
                <Fragment key={i}>
                  {i > 0 && (
                    <tr className="rae-diffcard__gap">
                      <td colSpan={4} />
                    </tr>
                  )}
                  {h.map((l, k) => (
                    <tr key={k} data-type={l.type}>
                      <td className="rae-cdiff__num">{l.type !== "add" ? l.a : ""}</td>
                      <td className="rae-cdiff__num">{l.type !== "del" ? l.b : ""}</td>
                      <td className="rae-cdiff__sign">{l.type === "add" ? "+" : l.type === "del" ? "−" : ""}</td>
                      <td className="rae-cdiff__code">
                        <Code tokens={l.type === "del" ? coloured?.before?.[l.a - 1] : coloured?.after?.[l.b - 1]} text={l.text} />
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
