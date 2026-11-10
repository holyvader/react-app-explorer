import type { GraphNode, ParamDef } from "@rae/schema";
import { Box, CodeToken, Flex, Text } from "@rae/design-system";
import { type ReactNode } from "react";
import { SourceCode } from "../Code.tsx";
import { TypeText } from "../TypeText.tsx";
import { shownType } from "../../lib/typeText.ts";

/* The details panel's code rows: one line of code tokens, and a parameter list. */

/** One line of code tokens, wrapping softly; optional right-aligned note. */
export function CodeRow({ children, aside, indent }: { children: ReactNode; aside?: string; indent?: boolean }) {
  return (
    <Flex
      align="baseline"
      gap="2"
      fontFamily="mono"
      fontSize="xs"
      lineHeight="1.6"
      px="2"
      py="0.5"
      ml={indent ? "2" : undefined}
      rounded="l1"
      transition="background 150ms ease"
      _hover={{ bg: "bg.subtle" }}
    >
      <Box flex="1" minW="0" wordBreak="break-word">
        {children}
      </Box>
      {aside && (
        <Text as="span" color="fg.subtle" flexShrink={0}>
          {aside}
        </Text>
      )}
    </Flex>
  );
}

export function Params({ params, owner }: { params: ParamDef[]; owner?: GraphNode }) {
  return (
    <>
      {params.map((p, i) => (
        <span key={i}>
          {i > 0 && <CodeToken kind="punct">, </CodeToken>}
          <CodeToken kind="name">{p.name}</CodeToken>
          {shownType(p) && (
            <>
              <CodeToken kind="punct">{p.optional && !p.default ? "?: " : ": "}</CodeToken>
              <TypeText text={shownType(p)!} owner={owner} optional={p.optional} />
            </>
          )}
          {p.default && (
            <>
              <CodeToken kind="punct"> = </CodeToken>
              <SourceCode text={p.default} />
            </>
          )}
        </span>
      ))}
    </>
  );
}
