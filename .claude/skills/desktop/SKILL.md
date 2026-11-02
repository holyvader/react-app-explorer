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
  `packages/desktop/src-tauri/binaries/rae-server-<rust triple>` and `binaries/tsgo/` (`tsc` + all
  `lib.*.d.ts`), bundled as the app resource folder `tsgo/`.
- `packages/desktop/src-tauri` — Rust shell (`src/lib.rs`): spawns the `rae-server` sidecar
  (`tauri-plugin-shell`) with `--snapshots <app data dir>/snapshots` and
  `RAE_TSGO_PATH=<resource dir>/tsgo/tsc`, waits for the URL line, navigates the `main` window there
  (it starts on `loading/index.html`), kills the sidecar on exit. The page gets **no Tauri
  permissions** (`capabilities/default.json` is empty) — it only speaks HTTP to the sidecar.

## Gotchas (each cost a debugging round)
- oxc's napi loaders pick their `.node` file at runtime, so `bun build --compile` doesn't embed them.
  `build.ts`'s plugin rewrites `require('@oxc-*/binding-<platform>')` **and** the
  `require('…/package.json').version` checks (otherwise the binding is rejected with
  "Cannot find native binding").
- TypeScript 7's Go binary can't run from inside a Bun executable → it ships as a resource folder,
  and the scanner takes its path from `RAE_TSGO_PATH` (`types/tsgo.ts`). The npm build of tsgo does
  **not** embed its lib files: without `lib.*.d.ts` next to it, it panics on the first request.
- The tsgo async client never rejects pending requests when its process dies, which used to hang
  the scan (the UI showed "scanning" forever). `applyTypes` watches the child and races its exit, so a
  crash becomes a "type pass skipped" warning and the scan finishes without types.
- Test packaged scans on a folder with **no `.explorer/cache`**: cached files skip parsing and the
  type pass, which hid the missing lib files (the original bug).
- **oxc-parser's loader is ESM with `createRequire(import.meta.url)`**: the bundler can't follow
  that `require`, so the `.node` path stayed a runtime string pointing into the *build machine's*
  node_modules. It worked on the build Mac and failed everywhere else ("The local server stopped").
  `build.ts` strips the `createRequire` line and the WebContainer fallback, then **guards** the
  result: both addons must appear as `/$bunfs/root/*.node`, and no build-machine path may remain.
  Test "another machine" by hiding the local `.node` files while running the sidecar.
- macOS signing: `bundle.macOS.signingIdentity: "-"` ad-hoc signs the **whole bundle** (sealed
  resources and nested sidecar). Without it the main binary was only linker-signed, and Gatekeeper
  assessed the sidecar separately, so downloaded copies hung or were killed. The hardened runtime
  needs `Entitlements.plist`: allow-jit plus unsigned-executable-memory (JavaScriptCore), and
  disable-library-validation (the embedded oxc addons). Without them the sidecar dies loading them.
  `minimumSystemVersion` is 13.0 (Bun's minimum).
- If the sidecar dies, `lib.rs` shows the reason (exit code/signal and the last stderr lines) on the
  bundled loading page (`window.raeServerFailed`), with the quarantine fix command.
- Downloaded builds are still quarantined and not notarized: users need right-click → Open, or
  `xattr -dr com.apple.quarantine "/Applications/React App Explorer.app"`. A real fix needs a
  Developer ID certificate plus notarization.
- **Diagnosing a user's machine:** the app's server logs to `~/Library/Logs/dev.rae.explorer/server.log`
  (the previous run is kept as `.1`). It records startup facts (macOS version, CPU, temp folder, the
  TypeScript binary and its lib files) and every scan step. Ask for this file first.
- The type pass also has a **stall watchdog** (`RAE_TYPES_STALL_MS`, default 60s with no file
  answered): a checker that stops responding without exiting would otherwise hang the scan.
- **Scans stream** (`POST /api/scan` → NDJSON `ScanEvent`s, the type is in @rae/schema): progress, a
  `result` once the structure snapshot is written, then `types` when the typed snapshot has
  replaced the same file. Shared producer: `runScanJob` in `@rae/scanner/job`. The server runs it
  in-process; the Vite plugin pipes `rae-scan --events`. Change one, check both.
  Cancelling: the page aborts the request. The server's `req.signal` / stream `cancel()` aborts the
  job; the plugin SIGTERMs the CLI, which aborts its job. Either way the type checker is killed.
- **The parser worker's path inside the executable** isn't next to the server: entry points are laid
  out relative to their common folder, so it's `/$bunfs/root/scanner/src/workers/extract.worker.js`.
  `build.ts` passes it as `process.env.RAE_EXTRACT_WORKER` (define), and the guard checks the path is in
  the binary. When it was missing, every project over 48 files (the inline threshold) hung in the
  file step, while small test projects passed. **Always test the packaged server on a big project.**
- A worker `error` now fails the scan with its message (it used to wait forever).
- `Bun.serve({ idleTimeout: 0 })`: the default 10s idle limit cut scan streams during quiet
  stretches (TypeScript loading a big project), which looked like a failure with no reason.
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
- Test the sidecar alone: `RAE_TSGO_PATH=…/binaries/tsgo/tsc …/rae-server-<triple> --port 5288 --snapshots <dir>`
  (never 5173 — that's the user's dev server).
- **Other platforms:** build on that OS (CI matrix) — Tauri bundles natively per platform, and the
  sidecar needs that platform's `@oxc-parser/binding-*`, `@oxc-resolver/binding-*` and
  `@typescript/typescript-*` installed. `build.ts --target bun-linux-x64|bun-windows-x64|…` picks them.
- Unsigned builds: macOS Gatekeeper / Windows SmartScreen warn. Signing + notarization are not set up.
- `/api/storage` (GET / PUT `{entries}`): the viewer's `rae.*` localStorage, kept in `<appData>/viewer-storage.json` next to the snapshots folder. The sidecar listens on `--port 0`, a new origin each launch, so the web view's localStorage would otherwise start empty.
