import { PanelSection, type PanelSectionProps } from "@rae/design-system";

/**
 * A details section that remembers being open or closed: collapse "Uses" once and it's collapsed
 * for every element. Keyed by its title (or `id` when the title isn't plain text or changes).
 */
export function Section({ id, ...props }: PanelSectionProps & { id?: string }) {
  const key = id ?? (typeof props.title === "string" ? props.title : undefined);
  return <PanelSection {...props} storageKey={key ? `rae.section:${key}` : undefined} />;
}
