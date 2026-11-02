import { DesignSystemProvider } from "@rae/design-system";
import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useExplorer } from "./store.ts";

// Dev-only handle for debugging and headless tests.
if (import.meta.env.DEV) (window as unknown as { __rae: typeof useExplorer }).__rae = useExplorer;

// Safari's engine (the desktop app's web view): flagged so the canvas can skip hover animations,
// which make it rasterise a card as a layer at 1× — blurry under the diagram's zoom until it ends.
const ua = navigator.userAgent;
if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) document.documentElement.dataset.webkit = "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSystemProvider>
      <App />
    </DesignSystemProvider>
  </StrictMode>,
);
