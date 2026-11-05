import { serverIsDesktop } from "./api.ts";

export type EditorKind = "idea" | "webstorm" | "vscode" | "cursor" | "zed";

export const EDITORS: { value: EditorKind; label: string }[] = [
  { value: "idea", label: "IntelliJ IDEA" },
  { value: "webstorm", label: "WebStorm" },
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "zed", label: "Zed" },
];

/**
 * The editors installed here (the server asks the OS which apps handle their URL schemes), or
 * `null` when it couldn't tell: then every editor is offered.
 */
/** Whether there is an editor to open files in (unknown counts as yes). */
export const canOpenEditor = (editors: EditorKind[] | null | undefined) => editors == null || editors.length > 0;

export async function fetchEditors(): Promise<EditorKind[] | null> {
  try {
    const res = await fetch("/api/editors");
    if (!res.ok) return null;
    const { editors } = (await res.json()) as { editors: string[] | null };
    return editors ? EDITORS.map((e) => e.value).filter((v) => editors.includes(v)) : null;
  } catch {
    return null;
  }
}

export function editorUrl(editor: EditorKind, absPath: string, line = 1, col = 1): string {
  const file = encodeURI(absPath);
  switch (editor) {
    case "vscode":
      return `vscode://file${file}:${line}:${col}`;
    case "cursor":
      return `cursor://file${file}:${line}:${col}`;
    case "zed":
      return `zed://file${file}:${line}:${col}`;
    case "webstorm":
      return `webstorm://open?file=${encodeURIComponent(absPath)}&line=${line}&column=${col}`;
    case "idea":
      return `idea://open?file=${encodeURIComponent(absPath)}&line=${line}&column=${col}`;
  }
}

/**
 * Opens a file in the editor. In a browser the editor's URL scheme (idea://, vscode://…) is simply
 * followed; the desktop app's web view won't open other apps' schemes, so its server asks the OS.
 */
/** A pull / merge request's page: a new browser tab; in the desktop app, the default browser (the server opens it). */
export async function openRequestPage(url: string): Promise<void> {
  if (!serverIsDesktop) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const res = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Couldn't open the page (${res.status})`);
}

export async function openInEditor(url: string): Promise<void> {
  if (!serverIsDesktop) {
    window.location.href = url;
    return;
  }
  const res = await fetch("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Couldn't open the editor (${res.status})`);
}
