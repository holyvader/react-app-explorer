---
name: desktop
description: Build, run or change the desktop app (Electron, packages/desktop) and its sidecar — the Bun-compiled local server (packages/server) that embeds the viewer, runs the scanner in-process and ships TypeScript 7's native binary. Use for packaging for macOS, sidecar/server API changes, or when the packaged app behaves differently from `bun run dev`.
---

# Desktop app (Electron + Bun sidecar)

## Shape
- `packages/server` (`@rae/server`) — `src/server.ts` is the packaged app's backend: `Bun.serve` on
  127.0.0.1 (port from `--port`, 0 = random), serves the built viewer and the **same API as the Vite
  plugin** (`/api/snapshots`, `/api/fs`, `POST /api/scan`, `/api/git/*`…), with the same loopback-Host /
  same-Origin guard. Scans run in-process via `@rae/scanner`'s `scan` + `writeSnapshot`. Prints
  `RAE_SERVER_URL=http://127.0.0.1:<port>` once listening.
  **Any API change must land in both** `packages/viewer/vite-plugin-snapshots.ts` and `server.ts`.
- `packages/server/build.ts` — builds the viewer, generates `src/embedded.generated.ts`
  (git-ignored; one `with { type: "file" }` import per dist file), compiles server + scanner worker
  into one executable and copies TypeScript 7's native `tsc` next to it:
  `packages/desktop/binaries/rae-server-<target triple>` and `binaries/tsgo/` (`tsc` + all `lib.*.d.ts`).
- `packages/desktop` (`@rae/desktop`) — Electron. `main.cjs`: opens the window on `loading/index.html`,
  spawns the sidecar with `--port 0 --snapshots <appData>/dev.rae.explorer/snapshots --log
  ~/Library/Logs/dev.rae.explorer/server.log` and `RAE_TSGO_PATH=<resources>/tsgo/tsc`, navigates to
  the URL it prints, shows why it died on the loading page (`window.raeServerFailed`). On quit it writes
  `quit` to the sidecar's stdin and kills it 400 ms later (a closed stdin also makes it stop its
  scripts). The page gets **nothing from Electron**: no preload, `contextIsolation` + `sandbox`, the
  window stays on the sidecar (127.0.0.1) and the loading page, only http(s) links open in the browser.
  The menu is its own (app, Edit, Window; Develop → Web Inspector ⌥⌘I only from source): Electron's
  default menu has Toggle Developer Tools and zoom shortcuts that would take ⌘+ / ⌘- from the diagram.
- `packages/desktop/package.ts` — `@electron/packager`: `React App Explorer.app` (bundle id
  `dev.rae.explorer`, the version from `package.json`, `LSMinimumSystemVersion` 13.0 — Bun's minimum),
  the sidecar, `tsgo/` and `loading/` as resources, ad-hoc signed (nested executables first), and a
  `.dmg` in `out/` made by **appdmg**: its window (660 × 400) has a **transparent** background
  (`dmg/background.png` + `@2x`, combined into a Retina TIFF), so Finder's own window shows through and
  follows Light / Dark Mode, like the names Finder writes under the icons (a .dmg has one picture for
  both modes and can't set the names' colour). Drawn on it, in one grey (#7E7E7E, ~4.1:1 on Finder's white
  and dark windows): the mark and name, a hairline, three chevrons from the app (165,192) to
  Applications (495,192), how to install. Icons 128 px; the app icon is the volume's. Change the look in
  `dmg/background.html`, then `bun packages/desktop/dmg/render.ts` (headless Chromium, the design
  system's bundled fonts, transparent PNGs) and commit the PNGs.
  appdmg runs as **its CLI under Node**: its `macos-alias` addon doesn't link CoreFoundation and only
  loads inside Node (Bun: "symbol not found … _kCFURLVolumeNameKey"). `macos-alias` and `fs-xattr` are
  in the root `trustedDependencies` (native builds).
- The data folders are the ones the app has always had (from its Tauri days, until 0.1.33): projects,
  snapshots and `viewer-storage.json` carry over.

## Gotchas (each cost a debugging round)
- The window has **no browser UI and a new origin each launch**: the viewer must behave the same as in Chrome on `bun run dev`. See the `frontend` skill, "Same behaviour in the web app and the desktop app", for the rules and the sidecar test recipe.
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
- macOS signing: ad hoc (`codesign --sign -`), the sidecar and `tsgo/tsc` first, then the bundle (Apple Silicon won't run unsigned code). No hardened runtime: it would need entitlements for the sidecar (allow-jit, unsigned-executable-memory for JavaScriptCore, disable-library-validation for the embedded oxc addons) — add them with it, for notarization.
- If the sidecar dies, `main.cjs` shows the reason (exit code/signal and the last stderr lines) on the
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
- App icon and branding: see the `design-system` skill ("Brand & shell"). `loading/index.html` shows the mark (inline SVG) while the sidecar starts.
- `bun run desktop:build` → `packages/desktop/out/React App Explorer-darwin-<arch>/React App Explorer.app` and
  `out/React App Explorer_<version>_<arch>.dmg`. `bun run desktop:dev` builds the sidecar and opens a dev window
  (`electron .`, reading `binaries/`); `bun --filter @rae/desktop start` skips the sidecar build.
- Releases: bump `version` in `packages/desktop/package.json`, build, publish the `.dmg` as a GitHub
  pre-release tagged `desktop-v<version>`.
- Check a packaged build: run `…/React App Explorer.app/Contents/MacOS/React App Explorer` from a shell
  (it logs `[rae] opening <url>`), curl that URL's `/api/snapshots`, then `kill -TERM` it — the sidecar
  must be gone afterwards.
- Test the sidecar alone: `RAE_TSGO_PATH=…/binaries/tsgo/tsc …/rae-server-<triple> --port 5288 --snapshots <dir>`
  (never 5173 — that's the user's dev server).
- **Other platforms:** `package.ts` makes the macOS app only (Linux / Windows: `@electron/packager`
  with that platform, build on that OS); the sidecar needs that platform's `@oxc-parser/binding-*`, `@oxc-resolver/binding-*` and
  `@typescript/typescript-*` installed. `build.ts --target bun-linux-x64|bun-windows-x64|…` picks them.
- Unsigned builds: macOS Gatekeeper / Windows SmartScreen warn. Signing + notarization are not set up.
- `/api/storage` (GET / PUT `{entries}`): the viewer's `rae.*` localStorage, kept in `<appData>/viewer-storage.json` next to the snapshots folder. The sidecar listens on `--port 0`, a new origin each launch, so the web view's localStorage would otherwise start empty.
- **package.json scripts** (`/api/scripts?path=`, `POST /api/scripts/run {path, script}`, `POST /api/scripts/stop {id}`, `GET /api/scripts/log?id=&from=` NDJSON): shared logic in `@rae/scanner/scripts` (scanner/src/scripts.ts), routes in both `server.ts` and the Vite plugin. Only scripts the package.json names, run by name with the folder's package manager (lockfile → bun / pnpm / yarn / npm), never a command from the page; the child gets the **login shell's PATH** (`$SHELL -ilc`, once; an app from the Finder has a bare PATH) and its own process group, so Stop ends what it started. Runs live in the server process (a page reload follows them again). On quit, `main.cjs` writes `quit` to the sidecar's stdin and waits 400 ms before killing it: a kill alone would leave the scripts' process groups running.
- **git fetch / update** (`POST /api/git/fetch`, `POST /api/git/pull` with `{path}`; `gitFetch` / `gitPull` in scanner/src/gitApi.ts) and `POST /api/scan` with `latest: "<branch>"` (a branch's newest commit, `latestTree({ branch })`; the CLI's `--branch`): in both servers.
- Scripts: a run ended by Stop (or quitting) is `stopped`, not `failed`; two run requests at once share one start (`starting`); on Windows a `.cmd` package manager starts through `cmd.exe /d /s /c` (script names with cmd.exe syntax refused); on quit the sidecar gives the scripts 150 ms, then kills their process groups. Branch names are checked with `isBranchName` (git's rules) and refused with a 400, never read as the working tree; `fetchBranch` fetches into a private ref, not FETCH_HEAD.
