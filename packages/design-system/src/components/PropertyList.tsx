import { DataList } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface PropertyItem {
  label: ReactNode;
  value: ReactNode;
}

/** Key/value list (label → value), e.g. node metadata. */
export function PropertyList({ items }: { items: PropertyItem[] }) {
  return (
    <DataList.Root orientation="horizontal" size="sm" gap="1.5">
      {items.map((it, i) => (
        <DataList.Item key={i}>
          <DataList.ItemLabel minW="20">{it.label}</DataList.ItemLabel>
          <DataList.ItemValue minW="0" wordBreak="break-word">
            {it.value}
          </DataList.ItemValue>
        </DataList.Item>
      ))}
    </DataList.Root>
  );
}
