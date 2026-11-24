import type { GraphNode } from "@rae/schema";
import { ActionIconButton, Box, Button, CodeToken, Flex, Stack, Text, textPx } from "@rae/design-system";
import { IconCodeDiff } from "@rae/design-system/icons";
import { type ReactNode, useState } from "react";
import { type ParamSide, propsTypeName, type SignatureChange, signatureChanges } from "../../lib/diff.ts";
import { useExplorer } from "../../store.ts";
import { NodeDiffModal } from "../NodeDiffModal.tsx";
import { hasCode, useNodeDiff } from "../../lib/nodeDiff.ts";
import { TypeText } from "../TypeText.tsx";
import { shownType } from "../../lib/typeText.ts";
import { plural } from "../../lib/text.ts";

/* The details panel's "In this diff": the signature's changes, the −/+ line counts, the code diff dialog. */

/**
 * "In this diff"'s header: the lines removed (−) and added (+) in the element's code — the same diff
 * the code diff dialog shows (loaded once, shared). Nothing while loading, or when the code can't be read.
 */
export function DiffLines({ node }: { node: GraphNode }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const { diff } = useNodeDiff(snapshot, node, hasCode(node));
  if (!diff) return null;
  return (
    <Text as="span" fontFamily="mono" fontSize={textPx(10.5)} title={`${plural(diff.removed, "line")} removed, ${diff.added} added`}>
      <Text as="span" color="diff.removed.fg">
        −{diff.removed}
      </Text>
      <Text as="span" color="fg.subtle">
        /
      </Text>
      <Text as="span" color="diff.added.fg">
        +{diff.added}
      </Text>
    </Text>
  );
}

/** One side of a change, like a diff line: − on red, + on green; `~` on amber for modified in place. */
function ChangeRow({ sign, change, title, children }: { sign: string; change: "added" | "removed" | "changed"; title?: string; children: ReactNode }) {
  return (
    <Flex align="baseline" gap="2" px="2" py="0.5" mb="1px" rounded="l1" bg={`diff.${change}.subtle`} fontFamily="mono" fontSize={textPx(11.5)} lineHeight="1.6" minW="0" title={title}>
      <Text as="span" color={`diff.${change}.fg`} flexShrink={0} userSelect="none">
        {sign}
      </Text>
      <Box minW="0" flex="1" overflowWrap="anywhere" color="fg">
        {children}
      </Box>
    </Flex>
  );
}

/** How many changes "In this diff" lists before "Show more". */
const DIFF_ITEMS = 5;

/**
 * What a diff did to the element: new, gone, or before → after (props, types, boundary, rendering…),
 * the first few with "Show more", its file's lines, and the code itself (split or inline) in a dialog.
 */
export function DiffView({ node, change }: { node: GraphNode; change: "added" | "removed" | "changed" }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const [more, setMore] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const diff = snapshot?.diff;
  if (!snapshot || !diff) return null;
  const before = diff.before[node.id];
  // only the signature here: props / parameters and the return type; the rest is in the code diff
  const all = change === "changed" && before ? signatureChanges(before, node, { annotations: !!diff.annotations }) : [];
  // props from a named type (`ButtonProps`): its name once (hover: what's inside) rather than each property
  const props = groupPropChanges(all, before, node);
  const items = props ? all.filter((c) => !(c.kind === "param" && c.isProp)) : all;
  const count = items.length + (props ? 1 : 0);
  const shown = more ? items : items.slice(0, DIFF_ITEMS);
  return (
    <Stack gap="2" fontSize={textPx(12.5)}>
      <Flex align="center" gap="2">
        <Text color="fg.muted" flex="1">
          {change === "added"
            ? `New in ${diff.head.ref}.`
            : change === "removed"
              ? `Removed: only ${diff.base.ref} (${diff.compared.slice(0, 7)}) has it.`
              : count
                ? `Signature changed${count > DIFF_ITEMS ? ` (${count})` : ""}:`
                : "Same signature: the code diff shows what changed."}
        </Text>
        {hasCode(node) && <ActionIconButton label="Show the code diff" icon={<IconCodeDiff />} size="2xs" variant="outline" onClick={() => setCodeOpen(true)} />}
      </Flex>
      {props && (
        <Box minW="0">
          <Text fontSize={textPx(11.5)} color="fg.subtle" mb="1">
            props type changed · {props.changes.length} {props.changes.length === 1 ? "property" : "properties"}
          </Text>
          {props.from === props.to ? (
            <ChangeRow sign="~" change="changed" title="Hover the name to see what's inside">
              <PropsTypeName name={props.to} owner={node} />
            </ChangeRow>
          ) : (
            <>
              <ChangeRow sign="−" change="removed">
                <PropsTypeName name={props.from} owner={before ?? node} />
              </ChangeRow>
              <ChangeRow sign="+" change="added">
                <PropsTypeName name={props.to} owner={node} />
              </ChangeRow>
            </>
          )}
          <Button size="2xs" variant="ghost" px="1.5" mt="0.5" color="fg.muted" onClick={() => setPropsOpen(!propsOpen)}>
            {propsOpen ? "Hide the property changes" : `Show the ${plural(props.changes.length, "property change")}`}
          </Button>
          {propsOpen && (
            <Stack gap="2" pl="3" mt="1" borderLeftWidth="2px" borderColor="diff.changed.subtle">
              {props.changes.map((it, i) => (
                <ItemView key={i} it={it} before={before} node={node} />
              ))}
            </Stack>
          )}
        </Box>
      )}
      {shown.map((it, i) => (
        <ItemView key={i} it={it} before={before} node={node} />
      ))}
      {items.length > DIFF_ITEMS && (
        <Button size="2xs" variant="ghost" alignSelf="start" px="1.5" color="fg.muted" onClick={() => setMore(!more)}>
          {more ? "Show less" : `Show more (${items.length - DIFF_ITEMS})`}
        </Button>
      )}
      {codeOpen && <NodeDiffModal node={node} snapshot={snapshot} open={codeOpen} onOpenChange={setCodeOpen} />}
    </Stack>
  );
}

/** One signature change: its label, then − before / + after (as in a diff). */
function ItemView({ it, before, node }: { it: SignatureChange; before?: GraphNode; node: GraphNode }) {
  const word = (c: Extract<SignatureChange, { kind: "param" }>) => `${c.isProp ? "prop" : "parameter"} ${c.what}`;
  return (
    <Box minW="0">
      <Text fontSize={textPx(11.5)} color="fg.subtle" mb="1">
        {it.kind === "param" ? word(it) : it.kind === "returned" ? "return value changed" : "return type"}
      </Text>
      {it.kind === "param" ? (
        <>
          {it.from && (
            <ChangeRow sign="−" change="removed">
              <ParamText p={it.from} owner={before ?? node} />
            </ChangeRow>
          )}
          {it.to && (
            <ChangeRow sign="+" change="added">
              <ParamText p={it.to} owner={node} />
            </ChangeRow>
          )}
        </>
      ) : it.kind === "returned" ? (
        // the same type, marked modified: what's returned changed (the code diff shows how)
        <ChangeRow sign="~" change="changed" title="The return type is the same; the returned code changed">
          <TypeText text={it.type} owner={node} />
        </ChangeRow>
      ) : (
        <>
          <ChangeRow sign="−" change="removed">
            <TypeText text={it.from} owner={before ?? node} />
          </ChangeRow>
          <ChangeRow sign="+" change="added">
            <TypeText text={it.to} owner={node} />
          </ChangeRow>
        </>
      )}
    </Box>
  );
}

/**
 * A component's prop changes, when its props come from a named type on both sides (`{ … }: ButtonProps`):
 * the type's name before and after, and the property changes (shown on demand).
 */
function groupPropChanges(all: SignatureChange[], before: GraphNode | undefined, node: GraphNode) {
  const changes = all.filter((c): c is Extract<SignatureChange, { kind: "param" }> => c.kind === "param" && c.isProp);
  const from = before && propsTypeName(before);
  const to = propsTypeName(node);
  return changes.length && from && to ? { from, to, changes } : undefined;
}

/** A props type by name, with its keyword (`interface ButtonProps`): the name links and, hovered, shows the declaration. */
function PropsTypeName({ name, owner }: { name: string; owner: GraphNode }) {
  const snapshot = useExplorer((s) => s.snapshot);
  const ident = name.match(/^[A-Za-z_$][\w$]*/)?.[0];
  const id = ident && owner.typeRefs?.[ident];
  const keyword = id ? snapshot?.nodes[id]?.typeKind : undefined;
  return (
    <Flex align="baseline" minW="0">
      {keyword && (
        <Text as="span" whiteSpace="pre">
          <CodeToken kind="keyword">{keyword} </CodeToken>
        </Text>
      )}
      <Box minW="0" flex="1">
        <TypeText text={name} owner={owner} />
      </Box>
    </Flex>
  );
}

/** A prop / parameter as in its signature: `name?: type` (just the name when its type isn't known). */
function ParamText({ p, owner }: { p: ParamSide; owner: GraphNode }) {
  return (
    <Flex align="baseline" minW="0">
      <CodeToken kind="name">{p.name}</CodeToken>
      {p.type !== undefined && (
        <>
          <Text as="span" whiteSpace="pre">
            <CodeToken kind="punct">{p.optional ? "?: " : ": "}</CodeToken>
          </Text>
          <Box minW="0" flex="1">
            <TypeText text={shownType(p)!} owner={owner} optional={p.optional} />
          </Box>
        </>
      )}
      {p.type === undefined && p.optional && <CodeToken kind="punct">?</CodeToken>}
    </Flex>
  );
}
