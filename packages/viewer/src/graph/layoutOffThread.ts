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
const waiting = new Map<number, { resolve: (placed: PlacedElement[]) => void; fallback: () => void }>();

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
export function layoutOffThread(graph: DrawnGraph, within: string | null, effort: LayoutEffort, mode: LayoutMode): Promise<PlacedElement[]> {
  const here = () => squareLayout(graph, within, effort, mode);
  const w = workerOf();
  if (!w) return Promise.resolve(here());
  const elements = new Map(graph.elements.map((e) => [e.id, e]));
  const id = ++next;
  return new Promise((resolve) => {
    waiting.set(id, {
      resolve: (placed) => resolve(placed.map((p) => ({ ...p, element: elements.get(p.element.id) ?? p.element }))),
      fallback: () => resolve(here()),
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
