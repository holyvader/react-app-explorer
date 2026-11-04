import type { JsxNode } from "@rae/schema";
import { Box, CodeToken, Flex, TagChip, Text } from "@rae/design-system";
import { IconChevronDown, IconChevronRight } from "@rae/design-system/icons";
import { useState } from "react";
import { CONDITION_LABEL, formatCondition } from "../lib/conditions.ts";
import { useExplorer } from "../store.ts";
import { SourceCode } from "./Code.tsx";

/** Children shown per element before "… N more". */
const MAX_CHILDREN = 40;

/** Condition chip colours: render conditions orange, loops purple, props grey. */
const CONDITION_COLOR: Record<string, string> = { map: "kind.hook.solid", prop: "kind.module.solid", "render-prop": "kind.module.solid" };

/** Collapsible JSX render tree including native elements, props and render conditions (code colours). */
export function RenderTree({ nodes }: { nodes: JsxNode[] }) {
  return (
    <Box fontFamily="mono" fontSize="xs" mx="-2">
      {nodes.map((n, i) => (
        <RenderTreeNode key={i} node={n} depth={0} />
      ))}
    </Box>
  );
}

function RenderTreeNode({ node, depth }: { node: JsxNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const [all, setAll] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const snapshot = useExplorer((s) => s.snapshot);
  const { addNodes } = useExplorer.getState();
  const target = node.targetId ? snapshot?.nodes[node.targetId] : undefined;
  const hasChildren = node.children.length > 0;
  const indent = depth * 14;

  return (
    <Box>
      {node.conditions.length > 0 && (
        <Flex gap="1" wrap="wrap" pl={`${indent + 26}px`} pt="1">
          {node.conditions.map((c, i) => (
            <TagChip key={i} color={CONDITION_COLOR[c.kind] ?? "kind.serverAction.solid"} mono title={`${c.kind}: ${c.expr}`}>
              <Text as="span" fontWeight="bold">
                {CONDITION_LABEL[c.kind]}
              </Text>
              {formatCondition(c)}
            </TagChip>
          ))}
        </Flex>
      )}
      <Flex align="center" gap="1" pl={`${indent + 8}px`} pr="2" py="0.5" rounded="l1" transition="background 150ms ease" _hover={{ bg: "bg.subtle" }}>
        <Box
          as="button"
          w="4"
          color="fg.subtle"
          visibility={hasChildren ? "visible" : "hidden"}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </Box>
        <Text
          as="button"
          fontWeight={node.native ? "normal" : "semibold"}
          color={target ? `kind.${target.kind}.fg` : node.native ? "syntax.keyword" : "syntax.name"}
          textDecoration={target && target.kind !== "external" ? "underline dotted" : undefined}
          textUnderlineOffset="3px"
          onClick={() => {
            if (target) addNodes([target.id], { select: target.id, focus: target.id, anchor: useExplorer.getState().selectedId });
            else setShowProps((s) => !s);
          }}
          title={target ? `Add ${target.name} to the diagram` : "Toggle props"}
        >
          <CodeToken kind="punct">&lt;</CodeToken>
          {node.tag}
          <CodeToken kind="punct">&gt;</CodeToken>
        </Text>
        {node.props.length > 0 && (
          <Text as="button" color="fg.subtle" onClick={() => setShowProps((s) => !s)} ml="1">
            {showProps ? "▾" : "▸"} {node.props.length} prop{node.props.length > 1 ? "s" : ""}
          </Text>
        )}
        <Text color="fg.subtle" ml="auto">
          :{node.loc.line}
        </Text>
      </Flex>
      {showProps && (
        <Box pl={`${indent + 30}px`} pb="1">
          {node.props.map((p, i) => (
            <Text key={i} wordBreak="break-all" lineHeight="1.6">
              <CodeToken kind="name">{p.name}</CodeToken>
              {!p.isSpread && (
                <>
                  <CodeToken kind="punct">=</CodeToken>
                  <SourceCode text={p.value ?? ""} />
                </>
              )}
            </Text>
          ))}
        </Box>
      )}
      {open && (all ? node.children : node.children.slice(0, MAX_CHILDREN)).map((c, i) => <RenderTreeNode key={i} node={c} depth={depth + 1} />)}
      {open && !all && node.children.length > MAX_CHILDREN && (
        <Text as="button" pl={`${indent + 32}px`} color="fg.muted" onClick={() => setAll(true)}>
          … {node.children.length - MAX_CHILDREN} more
        </Text>
      )}
    </Box>
  );
}
