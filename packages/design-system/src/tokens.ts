/** CSS variable of a colour token: `kind.serverAction.solid` → `var(--chakra-colors-kind-server-action-solid)`. */
export const tokenVar = (token: string) => `var(--chakra-colors-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replaceAll(".", "-")})`;
