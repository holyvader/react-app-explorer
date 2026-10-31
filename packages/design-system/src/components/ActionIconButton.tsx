import { IconButton, type IconButtonProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip.tsx";

export interface ActionIconButtonProps extends Omit<IconButtonProps, "aria-label" | "children"> {
  /** Accessible label, also shown as tooltip. */
  label: string;
  icon: ReactNode;
  /**
   * `rich` (default): design-system tooltip. `native`: the browser's title tooltip, no extra
   * component; use it for buttons rendered by the hundred (diagram nodes).
   */
  tooltip?: "rich" | "native";
}

/** Icon-only button with tooltip + aria-label. */
export function ActionIconButton({ label, icon, size = "xs", variant = "ghost", tooltip = "rich", ...rest }: ActionIconButtonProps) {
  const button = (
    <IconButton aria-label={label} title={tooltip === "native" ? label : undefined} size={size} variant={variant} {...rest}>
      {icon}
    </IconButton>
  );
  return tooltip === "native" ? button : <Tooltip content={label}>{button}</Tooltip>;
}
