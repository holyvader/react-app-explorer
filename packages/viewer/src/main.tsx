import { applyStoredColorMode, applyStoredDiagramPalette, applyStoredTextSize, DesignSystemProvider } from "@rae/design-system";
import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { syncStorage } from "./lib/storage.ts";

// Safari's engine (the desktop app's web view): flagged so the canvas can skip hover animations,
// which make it rasterise a card as a layer at 1× — blurry under the diagram's zoom until it ends.
const ua = navigator.userAgent;
if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) document.documentElement.dataset.webkit = "";

// The desktop app's stored settings and diagrams first (they live on its server): everything else
// is loaded after, because the store reads its settings from localStorage as it loads.
await syncStorage();
applyStoredColorMode();
applyStoredDiagramPalette();
applyStoredTextSize();
const [{ App }, { useExplorer }] = await Promise.all([import("./App.tsx"), import("./store.ts"), import("./lib/selectionHistory.ts")]);

// Dev-only handle for debugging and headless tests.
// VITE_RAE_HANDLE=1 at build time: the same handle in a production build, for profiling it (e2e/zoomProfile.ts).
if (import.meta.env.DEV || import.meta.env.VITE_RAE_HANDLE) (window as unknown as { __rae: typeof useExplorer }).__rae = useExplorer;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSystemProvider>
      <App />
    </DesignSystemProvider>
  </StrictMode>,
);
