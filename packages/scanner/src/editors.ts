import { execFile } from "node:child_process";

/**
 * Which editors can open files here: the OS is asked which app handles each editor's URL scheme
 * (`idea://`, `vscode://`…), exactly what "Open in editor" follows, so it finds apps wherever they
 * are installed (/Applications, ~/Applications, JetBrains Toolbox…). Node APIs only: the Vite dev
 * server (Node) and the desktop sidecar (Bun) both use it.
 */
export const EDITOR_SCHEMES = ["idea", "webstorm", "vscode", "cursor", "zed"] as const;
export type EditorScheme = (typeof EDITOR_SCHEMES)[number];

/** The installed editors, or `null` when the OS couldn't be asked (the viewer then offers them all). */
export interface EditorList {
  editors: EditorScheme[] | null;
}

const run = (cmd: string, args: string[]) =>
  new Promise<{ ok: boolean; out: string }>((done) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => done({ ok: !err, out: String(stdout) }));
  });

async function detect(): Promise<EditorScheme[] | null> {
  try {
    if (process.platform === "darwin") {
      // LaunchServices, through JXA: one call for every scheme
      const script = `ObjC.import('AppKit');
const ws = $.NSWorkspace.sharedWorkspace;
JSON.stringify(${JSON.stringify(EDITOR_SCHEMES)}.filter((s) => !ws.URLForApplicationToOpenURL($.NSURL.URLWithString(s + '://x')).isNil()));`;
      const r = await run("osascript", ["-l", "JavaScript", "-e", script]);
      return r.ok ? (JSON.parse(r.out.trim()) as EditorScheme[]) : null;
    }
    if (process.platform === "win32") {
      const found = await Promise.all(EDITOR_SCHEMES.map(async (s) => ((await run("reg", ["query", `HKCR\\${s}`, "/v", "URL Protocol"])).ok ? s : undefined)));
      return found.filter((s): s is EditorScheme => !!s);
    }
    const probe = await run("xdg-mime", ["--version"]);
    if (!probe.ok) return null;
    const found = await Promise.all(
      EDITOR_SCHEMES.map(async (s) => {
        const r = await run("xdg-mime", ["query", "default", `x-scheme-handler/${s}`]);
        return r.ok && r.out.trim() ? s : undefined;
      }),
    );
    return found.filter((s): s is EditorScheme => !!s);
  } catch {
    return null;
  }
}

let cached: Promise<EditorScheme[] | null> | undefined;
/** Asked once per server run (an editor installed meanwhile shows up after a restart, or with `refresh`). */
export async function installedEditors(refresh = false): Promise<EditorList> {
  if (refresh || !cached) cached = detect();
  return { editors: await cached };
}
