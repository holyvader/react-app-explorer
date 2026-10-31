export function formatTitle(title: string, max = 20): string {
  return title.length > max ? title.slice(0, max) + "…" : title;
}
