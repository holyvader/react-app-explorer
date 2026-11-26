// React App Explorer on Electron — an experiment next to the Tauri app (packages/desktop), to compare
// the diagram in bundled Chromium with the system's WebKit. It does what src-tauri/src/lib.rs does:
// starts the sidecar (server + scanner + built viewer, one Bun executable), waits for it to print its
// URL and points the window there. Same data folder as the Tauri app, so both show the same projects.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");

const URL_PREFIX = "RAE_SERVER_URL=";
// packaged: the sidecar and tsgo are resources; from source: the Tauri build's binaries (bun run sidecar)
const res = app.isPackaged ? process.resourcesPath : path.join(__dirname, "../desktop/src-tauri/binaries");
const serverBin = path.join(res, app.isPackaged ? "rae-server" : `rae-server-${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`);
const tsgo = path.join(res, "tsgo", process.platform === "win32" ? "tsc.exe" : "tsc");
const loadingPage = app.isPackaged ? path.join(res, "loading", "index.html") : path.join(__dirname, "../desktop/loading/index.html");
// the Tauri app's folders (identifier dev.rae.explorer): the same projects and settings in both
const dataDir = path.join(app.getPath("appData"), "dev.rae.explorer");
const logDir = path.join(app.getPath("home"), "Library", "Logs", "dev.rae.explorer");

const isWebLink = (url) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};
/** The sidecar's pages (on the loopback address) or the bundled loading page. */
const isOwnPage = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return path.resolve(decodeURIComponent(u.pathname)) === path.resolve(loadingPage);
    return u.protocol === "http:" && u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

/** @type {import("node:child_process").ChildProcess | null} */
let sidecar = null;

function showFailure(win, reason, details) {
  const call = `window.raeServerFailed && window.raeServerFailed(${JSON.stringify(reason)}, ${JSON.stringify(details)})`;
  const run = () => win.webContents.executeJavaScript(call).catch(() => {});
  if (!win.webContents.getURL().startsWith("file:")) void win.loadFile(loadingPage).then(run);
  else run();
}

function start(win) {
  mkdirSync(path.join(dataDir, "snapshots"), { recursive: true });
  mkdirSync(logDir, { recursive: true });
  sidecar = spawn(serverBin, ["--port", "0", "--snapshots", path.join(dataDir, "snapshots"), "--log", path.join(logDir, "server-electron.log")], {
    env: { ...process.env, RAE_TSGO_PATH: tsgo },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let navigated = false;
  const stderr = [];
  let out = "";
  sidecar.stdout.on("data", (chunk) => {
    out += chunk;
    const lines = out.split("\n");
    out = lines.pop() ?? "";
    for (const line of lines) {
      const url = line.trim().startsWith(URL_PREFIX) ? line.trim().slice(URL_PREFIX.length) : null;
      if (url && !navigated) {
        navigated = true;
        console.log(`[rae] opening ${url}`);
        void win.loadURL(url);
      }
    }
  });
  sidecar.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      console.error(`[rae-server] ${line}`);
      stderr.push(line);
      if (stderr.length > 20) stderr.shift();
    }
  });
  sidecar.on("error", (e) => showFailure(win, "It couldn't be started.", String(e)));
  sidecar.on("exit", (code, signal) => {
    if (app.isQuitting) return;
    const reason =
      signal === "SIGKILL"
        ? "It was killed by macOS (signal 9) — usually Gatekeeper blocking an app downloaded from the internet."
        : signal
          ? `It was stopped by signal ${signal}.`
          : `It exited with code ${code}.`;
    showFailure(win, reason, stderr.join("\n"));
  });
}

function createWindow() {
  const win = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1000, minHeight: 640, title: "React App Explorer (Electron)", backgroundColor: "#111214", show: false });
  win.once("ready-to-show", () => win.show());
  // links to other sites open in the browser, not in the app — web links only: the page shows
  // scanned projects' content, and any other scheme would hand a URL to another app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // the window itself stays on the sidecar (127.0.0.1) and the loading page
  win.webContents.on("will-navigate", (e, url) => {
    if (!isOwnPage(url)) e.preventDefault();
  });
  void win.loadFile(loadingPage);
  start(win);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (e) => {
  if (!sidecar || sidecar.exitCode !== null || app.isQuitting) return;
  // first ask it to stop the package.json scripts it runs (their own process groups), then kill it
  e.preventDefault();
  app.isQuitting = true;
  try {
    sidecar.stdin.write("quit\n");
  } catch {}
  setTimeout(() => {
    sidecar?.kill();
    app.quit();
  }, 400);
});
