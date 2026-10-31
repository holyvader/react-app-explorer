import { NativeSelect } from "@chakra-ui/react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  width?: string;
}

export function Select({ value, onValueChange, options, placeholder, size = "sm", width }: SelectProps) {
  return (
    <NativeSelect.Root size={size} width={width}>
      <NativeSelect.Field value={value} placeholder={placeholder} onChange={(e) => onValueChange(e.currentTarget.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
