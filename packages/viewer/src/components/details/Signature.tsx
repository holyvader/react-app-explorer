import type { GraphNode, ParamDef } from "@rae/schema";
import { Box, CodeToken, Eyebrow, Stack, Text } from "@rae/design-system";
import { SourceCode } from "../Code.tsx";
import { TypeText } from "../TypeText.tsx";
import { shownReturn, shownType } from "../../lib/typeText.ts";
import { CODE_BOX } from "./codeBox.ts";
import { CodeRow } from "./CodeRows.tsx";

/* The details panel's signature sections: generics, a component's props, inputs & output. */

/**
 * Generic type parameters (`T extends Item = Item`, one per row) and, for interfaces, what they
 * extend — named types are links, like everywhere in the details.
 */
export function Generics({ node }: { node: GraphNode }) {
  return (
    <Stack gap="3">
      {node.typeParams?.length ? (
        <Box>
          <Eyebrow>Type parameters</Eyebrow>
          <Stack gap="1.5" mt="1.5">
            {node.typeParams.map((t) => (
              <Box key={t.name} {...CODE_BOX} wordBreak="break-word">
                <CodeToken kind="name">{t.name}</CodeToken>
                {t.constraint && (
                  <>
                    <CodeToken kind="keyword"> extends </CodeToken>
                    <TypeText text={t.constraint} owner={node} />
                  </>
                )}
                {t.default && (
                  <>
                    <CodeToken kind="punct"> = </CodeToken>
                    <TypeText text={t.default} owner={node} />
                  </>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
      {node.extends?.length ? (
        <Box>
          <Eyebrow>Extends</Eyebrow>
          <Stack gap="1.5" mt="1.5">
            {node.extends.map((x, i) => (
              <Box key={i} {...CODE_BOX} wordBreak="break-word">
                <TypeText text={x} owner={node} />
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  );
}

/**
 * A component's props: each prop when they're known one by one, else its parameter's type (e.g.
 * `props: ButtonProps`, a link to that type); type parameters first if it's generic.
 */
export function ComponentProps({ node }: { node: GraphNode }) {
  const params = node.signature?.params ?? [];
  return (
    <Stack gap="3">
      {node.typeParams?.length ? <Generics node={node} /> : null}
      {node.props?.length ? (
        <Stack gap="0.5">
          {node.props.map((p) => (
            <CodeRow key={p.name}>
              <CodeToken kind="name">{p.name}</CodeToken>
              <CodeToken kind="punct">{p.optional ? "?: " : ": "}</CodeToken>
              <TypeText text={shownType(p) ?? "unknown"} owner={node} optional={p.optional} />
              {p.default && (
                <>
                  <CodeToken kind="punct"> = </CodeToken>
                  <SourceCode text={p.default} />
                </>
              )}
            </CodeRow>
          ))}
        </Stack>
      ) : params.length ? (
        <ParamRows node={node} params={params} />
      ) : (
        <Text fontSize="sm" color="fg.muted">
          None
        </Text>
      )}
    </Stack>
  );
}

/** One parameter per row; object types over several lines. */
function ParamRows({ node, params, mt }: { node: GraphNode; params: ParamDef[]; mt?: string }) {
  return (
    <Stack gap="1.5" mt={mt}>
      {params.map((p, i) => (
        <Box key={i} {...CODE_BOX} wordBreak="break-word">
          <CodeToken kind="name">{p.name}</CodeToken>
          {shownType(p) && (
            <>
              <CodeToken kind="punct">{p.optional && !p.default ? "?: " : ": "}</CodeToken>
              <TypeText text={shownType(p)!} owner={node} optional={p.optional} />
            </>
          )}
          {p.default && (
            <>
              <CodeToken kind="punct"> = </CodeToken>
              <SourceCode text={p.default} />
            </>
          )}
        </Box>
      ))}
    </Stack>
  );
}

/** Type parameters (if generic), inputs (one parameter per row) and output; object types over several lines. */
export function Signature({ node }: { node: GraphNode }) {
  const sig = node.signature!;
  const box = CODE_BOX;
  return (
    <Stack gap="3">
      {node.typeParams?.length ? <Generics node={node} /> : null}
      <Box>
        <Eyebrow>Inputs</Eyebrow>
        {sig.params.length ? (
          <ParamRows node={node} params={sig.params} mt="1.5" />
        ) : (
          <Text fontSize="sm" color="fg.muted" mt="1">
            None
          </Text>
        )}
      </Box>
      <Box>
        <Eyebrow>Output</Eyebrow>
        <Box {...box} mt="1.5" wordBreak="break-word">
          {node.isAsync && <CodeToken kind="keyword">async </CodeToken>}
          <TypeText text={shownReturn(sig) ?? "unknown"} owner={node} />
        </Box>
      </Box>
    </Stack>
  );
}
