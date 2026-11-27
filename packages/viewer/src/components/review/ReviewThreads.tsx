import type { ReviewThread } from "@rae/schema";
import { Popover } from "@rae/design-system";
import { IconComment } from "@rae/design-system/icons";
import { openRequestPage } from "../../lib/editor.ts";
import { ago, useReview } from "../../lib/review.ts";
import { useExplorer } from "../../store.ts";
import "./review.css";

/** Long comments are cut here; the rest is on the host's page. */
const BODY_MAX = 700;

const hostName = (url?: string) => (url?.includes("/-/merge_requests/") ? "GitLab" : "GitHub");

/** One review thread, read-only: where it is, its state, each comment, a link to it on the host. */
export function ReviewThreadView({ thread: t, where }: { thread: ReviewThread; where?: boolean }) {
  const link = t.comments.find((c) => c.url)?.url;
  return (
    <article className="rae-thread" data-resolved={t.resolved || undefined}>
      <header className="rae-thread__head">
        {where && (
          <span className="rae-thread__where">
            {t.path}
            {t.line ? `:${t.line}` : ""}
            {t.side === "old" ? " (base)" : ""}
          </span>
        )}
        <span className="rae-thread__state" data-state={t.resolved ? "resolved" : "open"}>
          {t.resolved ? "Resolved" : "Unresolved"}
        </span>
        {t.outdated && <span className="rae-thread__state" data-state="outdated">Outdated</span>}
      </header>
      {t.comments.map((c, i) => (
        <div key={i} className="rae-thread__comment">
          <div className="rae-thread__meta">
            <span className="rae-thread__avatar" aria-hidden>
              {(c.author ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <b>{c.author ?? "someone"}</b>
            <span>{ago(c.createdAt)}</span>
          </div>
          <div className="rae-thread__body">{c.body.length > BODY_MAX ? `${c.body.slice(0, BODY_MAX)}…` : c.body}</div>
        </div>
      ))}
      {link && (
        <button
          type="button"
          className="rae-thread__link"
          onClick={() => void openRequestPage(link).catch((e: Error) => useExplorer.getState().notify(e.message))}
        >
          Open on {hostName(link)} ↗
        </button>
      )}
    </article>
  );
}

/**
 * A badge on a card, row or file header: how many review threads are on it (filled while any is
 * unresolved). A click opens them in a popover (ReviewPopover). Plain HTML: drawn per node.
 */
export function ReviewBadge({ id, count, open }: { id: string; count: number; open: number }) {
  if (!count) return null;
  const label = `${count} review ${count === 1 ? "thread" : "threads"}${open ? `, ${open} unresolved` : ", all resolved"}`;
  return (
    <button
      type="button"
      className="rae-review-badge nodrag nopan"
      data-open={open > 0 || undefined}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        useReview.getState().setOpen({ id, x: r.left, y: r.bottom + 4 });
      }}
    >
      <IconComment size={11} />
      {count}
    </button>
  );
}

/** The threads of the badge clicked, in a popover at it. */
export function ReviewPopover() {
  const open = useReview((s) => s.open);
  const threads = useReview((s) => (s.open ? s.byNode.get(s.open.id) : undefined));
  const name = useExplorer((s) => (open ? s.snapshot?.nodes[open.id]?.name : undefined));
  return (
    <Popover open={!!open && !!threads} onOpenChange={(o) => !o && useReview.getState().setOpen(undefined)} at={open} placement="bottom-start" label={`Review comments on ${name ?? "this element"}`} width="420px" height="min(480px, calc(100dvh - 120px))">
      <div className="rae-threads">
        <div className="rae-threads__title">
          Review comments on <b>{name}</b>
        </div>
        {threads?.map((t) => <ReviewThreadView key={t.id} thread={t} where />)}
      </div>
    </Popover>
  );
}
