/** A scanned folder's name (its last path segment). */
export const projectName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;

/** A folder path with the home folder as `~` (macOS / Linux / Windows user folders). */
export const shortPath = (dir: string) => dir.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/, "~");
