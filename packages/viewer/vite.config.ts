import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { snapshotsPlugin } from "./vite-plugin-snapshots.ts";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react(), snapshotsPlugin(repoRoot)],
});
