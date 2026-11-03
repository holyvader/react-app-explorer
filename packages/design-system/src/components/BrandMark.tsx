/**
 * The Explorer mark: two chevrons around the explored node. One colour only (`currentColor`, the
 * foreground by default); never recolour the dot. 96 grid (drawn edge to edge): chevrons 38 wide, dot 16, overlap 6.
 * `tile` puts it on the app-icon tile (rounded square, mark at 58%), as in the desktop icon.
 */
export function BrandMark({ size = 22, title = "Explorer", tile = false, color }: { size?: number; title?: string; tile?: boolean; color?: string }) {
  const mark = (
    <g fill="none" stroke="currentColor" strokeWidth={38 / 12} strokeLinecap="round" strokeLinejoin="round">
      <path d="M31.75 57.5 22.25 48 31.75 38.5" />
      <path d="M64.25 57.5 73.75 48 64.25 38.5" />
      <circle cx="48" cy="48" r="8" fill="currentColor" stroke="none" />
    </g>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={tile ? "0 0 140 140" : "0 0 96 96"}
      role="img"
      aria-label={title}
      style={{ display: "block", flexShrink: 0, color: color ?? "var(--chakra-colors-fg)" }}
    >
      {tile ? (
        <>
          <rect x="0.5" y="0.5" width="139" height="139" rx="32" fill="var(--chakra-colors-bg-muted)" stroke="var(--chakra-colors-border-emphasized)" />
          {/* the mark at 58% of the tile */}
          <g transform="translate(30 30) scale(0.8333)">{mark}</g>
        </>
      ) : (
        mark
      )}
    </svg>
  );
}
