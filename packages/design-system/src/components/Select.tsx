import { NativeSelect } from "@chakra-ui/react";

export interface SelectOption {
  value: string;
  label: string;
  /** Options with the same group are listed together under it, groups in order of first appearance. */
  group?: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  width?: string;
  /** Accessible name (when no visible label is tied to it). */
  label?: string;
  disabled?: boolean;
}

export function Select({ value, onValueChange, options, placeholder, size = "sm", width, label, disabled }: SelectProps) {
  return (
    <NativeSelect.Root size={size} width={width} disabled={disabled}>
      <NativeSelect.Field value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onValueChange(e.currentTarget.value)}>
        {groupsOf(options).map(([group, items]) => {
          const rows = items.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ));
          return group === undefined ? rows : (
            <optgroup key={group} label={group}>
              {rows}
            </optgroup>
          );
        })}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

function groupsOf(options: SelectOption[]): [string | undefined, SelectOption[]][] {
  const groups = new Map<string | undefined, SelectOption[]>();
  for (const o of options) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
  return [...groups];
}
