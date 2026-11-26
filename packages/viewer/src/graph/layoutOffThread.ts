import type { DrawnGraph } from "./drawn.ts";
import type { PlacedElement } from "./layout.ts";
import type { LayoutRequest } from "./layout.worker.ts";
import { type LayoutEffort, type LayoutMode, squareLayout } from "./squareLayout.ts";

/*
 * Runs the layout search (graph/squareLayout.ts) in a worker, so the page doesn't freeze while it
 * searches. One worker, kept warm; requests answer in order. Where there are no workers (tests), or
 * the worker fails, the search runs here instead.
 */

let worker: Worker | null | undefined;
let next = 0;
const waiting = new Map<number, { resolve: (placed: PlacedElement[]) => void; fallback: () => void; reject: (e: Error) => void; channel?: string }>();

/** A layout no longer wanted: a newer one of the same kind replaced it before it was done. */
export class Superseded extends Error {
  constructor() {
    super("A newer layout replaced this one");
  }
}

/**
 * A newer job of `channel` (the canvas's full layout) arrived while an older one is still running:
 * the worker can't stop a search midway, so it's restarted — the old job rejected, any other job
 * waiting placed here instead.
 */
function supersede(channel: string) {
  const stale = [...waiting.entries()].filter(([, j]) => j.channel === channel);
  if (!stale.length || !worker) return;
  worker.terminate();
  worker = undefined;
  const others = [...waiting.values()].filter((j) => j.channel !== channel);
  for (const [, j] of stale) j.reject(new Superseded());
  waiting.clear();
  for (const j of others) j.fallback();
}

function workerOf(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "function" ? new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" }) : null;
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; placed?: PlacedElement[]; error?: string }>) => {
      const job = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (!job) return;
      if (e.data.placed) job.resolve(e.data.placed);
      else job.fallback();
    };
    // a worker that can't start (or dies): everything waiting, and all after, is placed here
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const job of waiting.values()) job.fallback();
      waiting.clear();
    };
  }
  return worker;
}

/**
 * The graph placed (all of it, or what `within` holds), as `squareLayout` would, without blocking
 * the page. The placed elements are the graph's own objects again (a worker's answer is a copy).
 */
export function layoutOffThread(graph: DrawnGraph, within: string | null, effort: LayoutEffort, mode: LayoutMode, channel?: string): Promise<PlacedElement[]> {
  const here = () => squareLayout(graph, within, effort, mode);
  if (channel) supersede(channel);
  const w = workerOf();
  if (!w) return Promise.resolve(here());
  const elements = new Map(graph.elements.map((e) => [e.id, e]));
  const id = ++next;
  return new Promise((resolve, reject) => {
    waiting.set(id, {
      resolve: (placed) => resolve(placed.map((p) => ({ ...p, element: elements.get(p.element.id) ?? p.element }))),
      fallback: () => resolve(here()),
      reject,
      channel,
    });
    const request: LayoutRequest = { id, graph, within, effort, mode };
    try {
      w.postMessage(request);
    } catch {
      // something in the graph that can't be copied to the worker
      waiting.delete(id);
      resolve(here());
    }
  });
}
