import { Box, chakra, textPx } from "@rae/design-system";
import { IconScripts } from "@rae/design-system/icons";
import { runWords, useScripts } from "../../lib/scripts.ts";
import { RunMark } from "./ScriptsConsole.tsx";

/** Chips at most: the rest are in the console. */
const MAX_CHIPS = 3;

const Chip = chakra("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "1.5",
    h: "26px",
    px: "2",
    rounded: "l2",
    flexShrink: 0,
    fontSize: textPx(12),
    color: "fg.muted",
    cursor: "pointer",
    whiteSpace: "nowrap",
    _hover: { color: "fg", bg: "bg.muted" },
    _focusVisible: { outline: "1.5px solid var(--chakra-colors-selection-solid)" },
  },
});

/**
 * The status bar's Scripts: a button opening the console, then a chip for each script running or
 * failed (click: the console on it). Nothing when the folder has no package.json.
 */
export function ScriptsChips() {
  const { info, runs, open, selected } = useScripts();
  const { show, close } = useScripts.getState();
  if (!info) return null;
  const shown = Object.values(runs)
    .filter((r) => r.summary.status === "running" || r.summary.status === "failed")
    .sort((a, b) => Number(b.summary.status === "running") - Number(a.summary.status === "running") || b.summary.startedAt - a.summary.startedAt)
    .slice(0, MAX_CHIPS);
  return (
    <>
      <Chip type="button" aria-expanded={open} bg={open ? "bg.muted" : undefined} color={open ? "fg" : undefined} title="package.json scripts (⌘K, then >)" onClick={() => (open ? close() : show())}>
        <IconScripts size={14} /> Scripts
      </Chip>
      {shown.map((r) => (
        <Chip
          key={r.summary.id}
          type="button"
          title={`${r.summary.script}: ${runWords(r.summary)}`}
          color={r.summary.status === "failed" ? "diff.removed.fg" : undefined}
          bg={open && selected === r.summary.script ? "bg.muted" : undefined}
          onClick={() => show(r.summary.script)}
        >
          <RunMark run={r} />
          <Box as="span">{r.summary.script}</Box>
        </Chip>
      ))}
    </>
  );
}
