import { Combobox, createListCollection } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import type { SelectOption } from "./Select.tsx";

export interface SearchSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Grouped like `Select`'s: options with the same `group` are listed under it, groups in order of first appearance. */
  options: SelectOption[];
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  width?: string;
  /** Accessible name. */
  label?: string;
  disabled?: boolean;
  /** Shown when the typed text matches nothing. */
  emptyText?: string;
}

/**
 * A dropdown with a filter: type to narrow the options (by label or group, case- and
 * accent-insensitive), ↑↓ Enter to pick. Opens on click showing everything, grouped.
 * The list isn't portalled (positioned fixed instead), so it works inside dialogs.
 */
export function SearchSelect({ value, onValueChange, options, placeholder, size = "sm", width, label, disabled, emptyText = "Nothing matches" }: SearchSelectProps) {
  const [query, setQuery] = useState("");
  const collection = useMemo(() => {
    const q = fold(query.trim());
    const items = q ? options.filter((o) => fold(o.label).includes(q) || (o.group && fold(o.group).includes(q))) : options;
    const order = new Map<string, number>();
    for (const o of options) if (!order.has(o.group ?? "")) order.set(o.group ?? "", order.size);
    return createListCollection({
      items,
      itemToValue: (o) => o.value,
      itemToString: (o) => o.label,
      groupBy: (o) => o.group ?? "",
      groupSort: (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    });
  }, [options, query]);
  const selected = options.find((o) => o.value === value);

  return (
    <Combobox.Root
      collection={collection}
      value={selected ? [value] : []}
      inputValue={query || (selected?.label ?? "")}
      onInputValueChange={(e) => setQuery(e.reason === "input-change" ? e.inputValue : "")}
      onValueChange={(e) => {
        setQuery("");
        if (e.value[0] !== undefined) onValueChange(e.value[0]);
      }}
      onOpenChange={(e) => !e.open && setQuery("")}
      openOnClick
      selectionBehavior="replace"
      size={size}
      width={width}
      disabled={disabled}
      positioning={{ strategy: "fixed", sameWidth: true, gutter: 4 }}
      lazyMount
      unmountOnExit
    >
      <Combobox.Control>
        <Combobox.Input placeholder={placeholder} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content maxH="320px" overflowY="auto" rounded="l3" shadow="popover">
          <Combobox.Empty px="3" py="2" color="fg.muted" fontSize="sm">
            {emptyText}
          </Combobox.Empty>
          {collection.group().map(([group, items]) => (
            <Combobox.ItemGroup key={group}>
              {group && (
                <Combobox.ItemGroupLabel fontFamily="mono" fontSize="11px" color="fg.subtle">
                  {group}
                </Combobox.ItemGroupLabel>
              )}
              {items.map((o) => (
                <Combobox.Item key={o.value} item={o}>
                  <Combobox.ItemText truncate>{o.label}</Combobox.ItemText>
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              ))}
            </Combobox.ItemGroup>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

/** Lower case without accents: what the filter compares. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
