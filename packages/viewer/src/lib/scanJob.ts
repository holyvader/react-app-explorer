import type { Snapshot } from "@rae/schema";
import { fetchSnapshot, runScan } from "./api.ts";
import { type ScanState, useExplorer } from "../store.ts";

/** How long the "Types added" note stays before the progress pill goes away. */
const DONE_LINGER_MS = 2500;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Runs a scan from the UI. The structure arrives first (`onStructure` loads it, the dialog closes);
 * the type pass continues in the background — its progress lives in the store (`scan`), and the
 * typed snapshot replaces the loaded one in place when it lands. Lives outside components so it
 * survives the dialog closing.
 */
export async function startScan(path: string, types: boolean, onStructure: (file: string) => void): Promise<void> {
  const { setScan } = useExplorer.getState();
  clearTimeout(clearTimer);
  setScan({ path, phase: "structure", stage: "discover" });
  const patch = (p: Partial<ScanState>) => {
    const cur = useExplorer.getState().scan;
    if (cur) setScan({ ...cur, ...p });
  };
  try {
    await runScan(path, types, (e) => {
      switch (e.type) {
        case "progress":
          patch({ stage: e.stage, done: e.done, total: e.total, ...(e.stage === "types" ? { phase: "types" } : {}) });
          break;
        case "result":
          patch({ file: e.file, phase: e.typesPending ? "types" : "typed", stage: e.typesPending ? "types" : undefined, done: undefined, total: undefined });
          onStructure(e.file);
          if (!e.typesPending) finish();
          break;
        case "types":
          patch({ phase: "typed", typed: e.typed, message: e.typed ? undefined : (e.warnings.at(-1) ?? "The type pass failed") });
          void fetchSnapshot(e.file).then((snap) => applyTyped(e.file, snap));
          finish(e.typed ? DONE_LINGER_MS : 8000);
          break;
        case "error":
          patch({ phase: "failed", message: e.message });
          break;
        case "done":
          break;
      }
    });
    // the stream ended without an outcome (server stopped mid-scan)
    const s = useExplorer.getState().scan;
    if (s && (s.phase === "structure" || s.phase === "types")) patch({ phase: "failed", message: "The scan stopped before it finished" });
  } catch (e) {
    patch({ phase: "failed", message: (e as Error).message });
  }
}

let unsubscribe: (() => void) | undefined;

/**
 * Puts the typed snapshot on screen — now if `file` is the one shown, or as soon as it is: on a
 * fast project the types can land before the structure snapshot has finished loading (which would
 * otherwise win and leave the diagram untyped).
 */
function applyTyped(file: string, typed: Snapshot) {
  unsubscribe?.();
  const apply = () => {
    const s = useExplorer.getState();
    if (s.snapshotName === file && s.snapshot !== typed && !s.snapshot?.stats.types) s.updateSnapshot(typed, file);
  };
  apply();
  unsubscribe = useExplorer.subscribe((s, prev) => {
    if (s.snapshot !== prev.snapshot) apply();
  });
  setTimeout(() => {
    unsubscribe?.();
    unsubscribe = undefined;
  }, 30_000);
}

function finish(after = DONE_LINGER_MS) {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    const s = useExplorer.getState().scan;
    if (s?.phase === "typed") useExplorer.getState().setScan(undefined);
  }, after);
}

/** Dismisses a finished or failed scan's note. */
export function dismissScan() {
  clearTimeout(clearTimer);
  useExplorer.getState().setScan(undefined);
}
