export type EditorKind = "idea" | "webstorm" | "vscode" | "cursor";

export const EDITORS: { value: EditorKind; label: string }[] = [
  { value: "idea", label: "IntelliJ IDEA" },
  { value: "webstorm", label: "WebStorm" },
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
];

export function editorUrl(editor: EditorKind, absPath: string, line = 1, col = 1): string {
  const file = encodeURI(absPath);
  switch (editor) {
    case "vscode":
      return `vscode://file${file}:${line}:${col}`;
    case "cursor":
      return `cursor://file${file}:${line}:${col}`;
    case "webstorm":
      return `webstorm://open?file=${encodeURIComponent(absPath)}&line=${line}&column=${col}`;
    case "idea":
      return `idea://open?file=${encodeURIComponent(absPath)}&line=${line}&column=${col}`;
  }
}
