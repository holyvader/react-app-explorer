import { useId } from "react";

/**
 * The React App Explorer mark: a component, a hook and a server action around the explored node,
 * on a deep teal-to-ink tile. Same artwork as the app icon (packages/desktop/src-tauri/icons),
 * edge to edge (no icon-grid margin).
 */
export function BrandMark({ size = 32, title = "React App Explorer" }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  const u = (name: string) => `${name}-${id}`;
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" role="img" aria-label={title} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <linearGradient id={u("bg")} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#1D4E63" />
          <stop offset="0.55" stopColor="#14304A" />
          <stop offset="1" stopColor="#0B1426" />
        </linearGradient>
        <radialGradient id={u("glow")} cx="0.5" cy="0.46" r="0.5">
          <stop offset="0" stopColor="#7DD3E8" stopOpacity="0.45" />
          <stop offset="1" stopColor="#7DD3E8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={u("core")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D6EEF4" />
        </linearGradient>
        <linearGradient id={u("teal")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#82C8DA" />
          <stop offset="1" stopColor="#429CB5" />
        </linearGradient>
        <linearGradient id={u("violet")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C4B5FD" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id={u("amber")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FDBA74" />
          <stop offset="1" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="186" fill={`url(#${u("bg")})`} />
      <rect x="100" y="100" width="824" height="824" rx="186" fill={`url(#${u("glow")})`} />
      <circle cx="512" cy="500" r="196" fill="none" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="10" strokeDasharray="2 30" strokeLinecap="round" />
      <g stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="22" strokeLinecap="round">
        <line x1="512" y1="500" x2="318" y2="322" />
        <line x1="512" y1="500" x2="716" y2="330" />
        <line x1="512" y1="500" x2="600" y2="732" />
      </g>
      <rect x="244" y="248" width="148" height="148" rx="40" fill={`url(#${u("teal")})`} />
      <rect x="648" y="262" width="136" height="136" rx="68" fill={`url(#${u("violet")})`} />
      <rect x="536" y="668" width="128" height="128" rx="34" fill={`url(#${u("amber")})`} transform="rotate(12 600 732)" />
      <circle cx="512" cy="500" r="104" fill={`url(#${u("core")})`} />
      <circle cx="512" cy="500" r="52" fill="#14304A" />
      <circle cx="512" cy="500" r="22" fill="#7DD3E8" />
    </svg>
  );
}
