---
name: desktop
description: Build, run or change the desktop app (Tauri v2, packages/desktop) and its sidecar — the Bun-compiled local server (packages/server) that embeds the viewer, runs the scanner in-process and ships TypeScript 7's native binary. Use for packaging for macOS/Linux/Windows, sidecar/server API changes, or when the packaged app behaves differently from `bun run dev`.
---

# Desktop app (Tauri + Bun sidecar)

## Shape
- `packages/server` (`@rae/server`) — `src/server.ts` is the packaged app's backend: `Bun.serve` on
  127.0.0.1 (port from `--port`, 0 = random), serves the built viewer and the **same API as the Vite
  plugin** (`/api/snapshots`, `/api/fs`, `POST /api/scan`), with the same loopback-Host / same-Origin
  guard. Scans run in-process via `@rae/scanner`'s `scan` + `writeSnapshot`. Prints
  `RAE_SERVER_URL=http://127.0.0.1:<port>` once listening.
  **Any API change must land in both** `packages/viewer/vite-plugin-snapshots.ts` and `server.ts`.
- `packages/server/build.ts` — builds the viewer, generates `src/embedded.generated.ts`
  (git-ignored; one `with { type: "file" }` import per dist file), compiles server + scanner worker
  into one executable and copies TypeScript 7's native `tsc` next to it:
  `packages/desktop/src-tauri/binaries/rae-server-<rust triple>` and `rae-tsgo-<rust triple>`.
- `packages/desktop/src-tauri` — Rust shell (`src/lib.rs`): spawns the `rae-server` sidecar
  (`tauri-plugin-shell`) with `--snapshots <app data dir>/snapshots` and
  `RAE_TSGO_PATH=<exe dir>/rae-tsgo`, waits for the URL line, navigates the `main` window there
  (it starts on `loading/index.html`), kills the sidecar on exit. The page gets **no Tauri
  permissions** (`capabilities/default.json` is empty) — it only speaks HTTP to the sidecar.

## Gotchas (each cost a debugging round)
- oxc's napi loaders pick their `.node` file at runtime, so `bun build --compile` doesn't embed them.
  `build.ts`'s plugin rewrites `require('@oxc-*/binding-<platform>')` **and** the
  `require('…/package.json').version` checks (otherwise the binding is rejected with
  "Cannot find native binding").
- TypeScript 7's Go binary can't run from inside a Bun executable → it ships as a second sidecar,
  and the scanner takes its path from `RAE_TSGO_PATH` (`types/tsgo.ts`). Its lib `.d.ts` files are
  built into the binary, so nothing else is needed.
- The scanner's worker must be a second entry point of the compile (`new Worker(new URL(...))`
  resolves inside the executable).
- Production viewer builds don't expose `window.__rae`, so `e2e/smoke.ts` can't run against the
  packaged server; drive it with clicks instead.

## Run / build
- `bun run desktop:build` → `packages/desktop/src-tauri/target/release/bundle/` (`.app` + `.dmg` on
  macOS, `.deb`/`.AppImage`/`.rpm` on Linux, `.msi`/NSIS on Windows). `bun run desktop:dev` for a dev
  window. Quick macOS-only bundle: `bunx tauri build --bundles app` in packages/desktop.
- Rust comes from rustup in `~/.cargo` (installed without touching the shell profile); the desktop
  scripts prepend `~/.cargo/bin` to PATH.
- Test the sidecar alone: `RAE_TSGO_PATH=…/rae-tsgo-<triple> …/rae-server-<triple> --port 5288 --snapshots <dir>`
  (never 5173 — that's the user's dev server).
- **Other platforms:** build on that OS (CI matrix) — Tauri bundles natively per platform, and the
  sidecar needs that platform's `@oxc-parser/binding-*`, `@oxc-resolver/binding-*` and
  `@typescript/typescript-*` installed. `build.ts --target bun-linux-x64|bun-windows-x64|…` picks them.
- Unsigned builds: macOS Gatekeeper / Windows SmartScreen warn. Signing + notarization are not set up.
