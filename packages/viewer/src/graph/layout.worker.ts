/// <reference lib="webworker" />
import type { DrawnGraph } from "./drawn.ts";
import { type LayoutEffort, type LayoutMode, squareLayout } from "./squareLayout.ts";

/* The layout search, off the page's thread (graph/layoutOffThread.ts): the canvas stays live while it runs. */

export interface LayoutRequest {
  id: number;
  graph: DrawnGraph;
  within: string | null;
  effort: LayoutEffort;
  mode: LayoutMode;
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { id, graph, within, effort, mode } = e.data;
  try {
    self.postMessage({ id, placed: squareLayout(graph, within, effort, mode) });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
