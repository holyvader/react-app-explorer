import { type ReactNode, useMemo } from "react";
import { FIRST_LEVEL, type LayoutOptions, layoutDefinition, layoutType, lexSource, type Tok, type TokLine } from "../lib/syntax.ts";
import "./syntax.css";

/** Renders one token; `link` may turn a type name into something clickable. */
export type TokenRenderer = (tok: Tok, key: string) => ReactNode;

/** Coloured lines of code (see lib/syntax.ts), joined by line breaks. */
export function CodeLines({ lines, render, block, className }: { lines: TokLine[]; render?: TokenRenderer; block?: boolean; className?: string }) {
  return (
    <span className={`rae-code${className ? ` ${className}` : ""}`} data-block={block || undefined}>
      {lines.map((line, n) => (
        <span key={n}>
          {n > 0 && "\n"}
          {line.map((t, i) => (render ? render(t, `${n}.${i}`) : <span key={i} className={`rae-tok--${t.k}`}>{t.t}</span>))}
        </span>
      ))}
    </span>
  );
}

/** A type, laid out to a width and coloured (no links: tooltips, previews) — first level only: nested objects folded. */
export function TypeCode({ text, width, start, flat, optional }: { text: string } & LayoutOptions) {
  const lines = useMemo(() => layoutType(text, { width, start, flat, optional, fold: FIRST_LEVEL }), [text, width, start, flat, optional]);
  return <CodeLines lines={lines} />;
}

/** A definition (interface, alias) for a tooltip: its members, their object values folded (first level only). */
export function DefinitionCode({ text, width = 72, maxLines }: { text: string; width?: number; maxLines?: number }) {
  const lines = useMemo(() => {
    const all = layoutDefinition(text, width, () => true);
    return maxLines && all.length > maxLines ? [...all.slice(0, maxLines), [{ k: "punct" as const, t: "…" }]] : all;
  }, [text, width, maxLines]);
  return <CodeLines lines={lines} block />;
}

/** Source as written (an expression, a definition), coloured. `maxLines` cuts it with "…". */
export function SourceCode({ text, maxLines, block }: { text: string; maxLines?: number; block?: boolean }) {
  const lines = useMemo(() => {
    const all = lexSource(text);
    return maxLines && all.length > maxLines ? [...all.slice(0, maxLines), [{ k: "punct" as const, t: "…" }]] : all;
  }, [text, maxLines]);
  return <CodeLines lines={lines} block={block} />;
}
