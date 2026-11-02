/**
 * Keeps the viewer's localStorage (settings, the last snapshot, each project's diagram) across
 * desktop-app launches. The app's server listens on a new port each launch, a new origin for the
 * web view, so localStorage starts empty every time: the server keeps a copy (`/api/storage`).
 *
 * In the browser (the Vite dev server has no such endpoint) this does nothing: localStorage persists.
 */
const PREFIX = "rae.";
const SAVE_DELAY = 250;

function entries(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) out[k] = localStorage.getItem(k)!;
  }
  return out;
}

/** Restores the server's copy into localStorage, then mirrors every change back. Call before rendering. */
export async function syncStorage(): Promise<void> {
  let saved: Record<string, string>;
  try {
    const res = await fetch("/api/storage");
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return;
    const body = (await res.json()) as { entries?: unknown };
    if (!body.entries || typeof body.entries !== "object") return;
    saved = body.entries as Record<string, string>;
  } catch {
    return;
  }
  for (const [k, v] of Object.entries(saved)) if (k.startsWith(PREFIX) && typeof v === "string") localStorage.setItem(k, v);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = (keepalive = false) => {
    clearTimeout(timer);
    timer = undefined;
    void fetch("/api/storage", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries: entries() }), keepalive }).catch(() => {});
  };
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
  };
  // every write to localStorage, from anywhere in the viewer
  const proto = Storage.prototype;
  const { setItem, removeItem, clear } = proto;
  proto.setItem = function (this: Storage, k: string, v: string) {
    setItem.call(this, k, v);
    if (this === localStorage && k.startsWith(PREFIX)) changed();
  };
  proto.removeItem = function (this: Storage, k: string) {
    removeItem.call(this, k);
    if (this === localStorage && k.startsWith(PREFIX)) changed();
  };
  proto.clear = function (this: Storage) {
    clear.call(this);
    if (this === localStorage) changed();
  };
  // closing the window: send what's pending now
  addEventListener("pagehide", () => timer !== undefined && save(true));
}
