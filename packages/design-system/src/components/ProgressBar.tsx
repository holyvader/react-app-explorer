import { Progress } from "@chakra-ui/react";

export interface ProgressBarProps {
  /** 0–100; `null` → indeterminate (a moving stripe). */
  value: number | null;
  size?: "xs" | "sm" | "md";
  colorPalette?: string;
  label?: string;
  /** Pixel width; full width by default. */
  width?: string | number;
}

/** A thin progress bar; indeterminate while the total isn't known yet. */
export function ProgressBar({ value, size = "xs", colorPalette = "component", label, width = "full" }: ProgressBarProps) {
  return (
    <Progress.Root value={value} max={100} size={size} colorPalette={colorPalette} width={width} aria-label={label} striped={value === null} animated={value === null}>
      <Progress.Track rounded="full">
        <Progress.Range rounded="full" transition="width 0.2s ease-out" />
      </Progress.Track>
    </Progress.Root>
  );
}
