import { Box, Combobox, createListCollection, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import type { SelectOption } from "./Select.tsx";
import { textPx } from "../textSize.ts";

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
 * A dropdown with a filter: type to narrow the options (by label, detail or group, case- and
 * accent-insensitive), ↑↓ Enter to pick. Opens on click showing everything, grouped.
 * The list isn't portalled (positioned fixed instead), so it works inside dialogs.
 */
export function SearchSelect({ value, onValueChange, options, placeholder, size = "sm", width, label, disabled, emptyText = "Nothing matches" }: SearchSelectProps) {
  const [query, setQuery] = useState("");
  // open: the field is empty for typing, the current choice shown as its placeholder (nothing to delete first)
  const [open, setOpen] = useState(false);
  const collection = useMemo(() => {
    const q = fold(query.trim());
    const items = q ? options.filter((o) => fold(o.label).includes(q) || (o.detail && fold(o.detail).includes(q)) || (o.detailLead && fold(o.detailLead).includes(q)) || (o.group && fold(o.group).includes(q))) : options;
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
      inputValue={open ? query : (selected?.label ?? "")}
      onInputValueChange={(e) => setQuery(e.reason === "input-change" ? e.inputValue : "")}
      onValueChange={(e) => {
        setQuery("");
        if (e.value[0] !== undefined) onValueChange(e.value[0]);
      }}
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) setQuery("");
      }}
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
        <Combobox.Input placeholder={open && selected ? selected.label : placeholder} aria-label={label} />
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
                // sticky: which group the rows under it belong to stays in sight while scrolling
                <Combobox.ItemGroupLabel fontFamily="mono" fontSize={textPx(11)} color="fg.subtle" position="sticky" top="-4px" zIndex="1" bg="bg.panel">
                  {group}
                </Combobox.ItemGroupLabel>
              )}
              {items.map((o) => (
                <Combobox.Item key={o.value} item={o} alignItems={o.detail || o.detailLead ? "start" : undefined}>
                  <Box flex="1" minW="0">
                    <Combobox.ItemText truncate display="block">
                      {o.parts
                        ? o.parts.map((p, i) => (
                            <Text as="span" key={i} color={p.tone === "dim" ? "fg.subtle" : undefined} fontWeight={p.tone === "strong" ? "semibold" : undefined}>
                              {p.text}
                            </Text>
                          ))
                        : o.label}
                    </Combobox.ItemText>
                    {(o.detail || o.detailLead) && (
                      <Text truncate fontSize={textPx(11.5)} color="fg.muted" title={[o.detailLead, o.detail].filter(Boolean).join(" · ")}>
                        {o.detailLead && (
                          <Text as="span" fontWeight="medium" color="fg">
                            {o.detailLead}
                          </Text>
                        )}
                        {o.detailLead && o.detail ? " · " : ""}
                        {o.detail}
                      </Text>
                    )}
                  </Box>
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
