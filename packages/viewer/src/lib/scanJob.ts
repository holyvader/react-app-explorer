import type { Snapshot } from "@rae/schema";
import { fetchSnapshot, runScan, serverLogFile } from "./api.ts";
import { type ScanState, useExplorer } from "../store.ts";

/** How long the "Types added" note stays before the progress panel goes away. */
const DONE_LINGER_MS = 2500;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let running: AbortController | undefined;

/** A failure always says why — and, in the desktop app, where the details are. */
const failed = (why: string | undefined): Partial<ScanState> => ({
  phase: "failed",
  message: `${why?.trim() || "The scan failed for an unknown reason."}${serverLogFile ? `\nDetails: ${serverLogFile}` : ""}`,
});

const patch = (p: Partial<ScanState>) => {
  const cur = useExplorer.getState().scan;
  if (cur) useExplorer.getState().setScan({ ...cur, ...p });
};

/**
 * Runs a scan from the UI. Its progress lives in the store (`scan`) — the panel over the canvas
 * shows it from start to end. The structure snapshot is loaded as soon as it's written
 * (`onStructure`); the type pass continues and its typed snapshot replaces the loaded one in place.
 * Lives outside components so it survives dialogs closing; `cancelScan` stops it.
 */
export async function startScan(path: string, types: boolean, onStructure: (file: string) => void): Promise<void> {
  clearTimeout(clearTimer);
  running?.abort();
  const controller = new AbortController();
  running = controller;
  useExplorer.getState().setScan({ path, phase: "structure", stage: "discover", withTypes: types, startedAt: Date.now() });
  try {
    await runScan(
      path,
      types,
      (e) => {
        switch (e.type) {
          case "progress":
            if (e.stage === "parse" && e.total) patch({ stage: "parse", parse: { done: e.done ?? 0, total: e.total } });
            else if (e.stage === "types" && e.total !== undefined) {
              const prev = useExplorer.getState().scan?.types;
              const loading = e.loading ?? prev?.loading ?? false;
              patch({ phase: "types", stage: "types", types: { done: e.done ?? 0, total: e.total, loading, since: prev?.since ?? Date.now() } });
            } else patch({ stage: e.stage });
            break;
          case "result": {
            const parse = useExplorer.getState().scan?.parse;
            patch({ file: e.file, stage: e.typesPending ? "types" : undefined, phase: e.typesPending ? "types" : "typed", parse: parse && { done: parse.total, total: parse.total } });
            onStructure(e.file);
            if (!e.typesPending) finish();
            break;
          }
          case "types":
            patch({ phase: "typed", typed: e.typed, message: e.typed ? undefined : (e.warnings.at(-1) ?? "The type pass failed") });
            void fetchSnapshot(e.file).then((snap) => applyTyped(e.file, snap));
            finish(e.typed ? DONE_LINGER_MS : 8000);
            break;
          case "error":
            patch(failed(e.message));
            break;
          case "cancelled":
            patch({ phase: "cancelled" });
            finish(DONE_LINGER_MS);
            break;
          case "done":
            break;
        }
      },
      controller.signal,
    );
    // the stream ended without an outcome (server stopped mid-scan)
    const s = useExplorer.getState().scan;
    if (s && (s.phase === "structure" || s.phase === "types")) patch(failed("The connection to the scanner closed before the scan finished."));
  } catch (e) {
    if (controller.signal.aborted) {
      patch({ phase: "cancelled" });
      finish(DONE_LINGER_MS);
    } else patch(failed((e as Error).message));
  } finally {
    if (running === controller) running = undefined;
  }
}

/**
 * Stops the running scan: the request is aborted, and the server stops parsing or kills the type
 * checker. A structure snapshot already loaded stays (without types).
 */
export function cancelScan() {
  running?.abort();
}

export const isScanning = (s: ScanState | undefined) => s?.phase === "structure" || s?.phase === "types";

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

/** Clears the panel after a moment — finished, cancelled, or typed without types; errors stay until dismissed. */
function finish(after = DONE_LINGER_MS) {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    const s = useExplorer.getState().scan;
    if (s && !isScanning(s) && s.phase !== "failed") useExplorer.getState().setScan(undefined);
  }, after);
}

/** Dismisses a finished, failed or cancelled scan's panel. */
export function dismissScan() {
  clearTimeout(clearTimer);
  if (!isScanning(useExplorer.getState().scan)) useExplorer.getState().setScan(undefined);
}
