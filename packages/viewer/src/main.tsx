import { DesignSystemProvider } from "@rae/design-system";
import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { useExplorer } from "./store.ts";

// Dev-only handle for debugging and headless tests.
if (import.meta.env.DEV) (window as unknown as { __rae: typeof useExplorer }).__rae = useExplorer;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesignSystemProvider>
      <App />
    </DesignSystemProvider>
  </StrictMode>,
);
