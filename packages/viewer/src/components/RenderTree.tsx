import type { JsxNode } from "@rae/schema";
import { Box, CodeChip, Flex, Text, Tooltip } from "@rae/design-system";
import { IconChevronDown, IconChevronRight } from "@rae/design-system/icons";
import { useState } from "react";
import { CONDITION_LABEL, formatCondition } from "../lib/conditions.ts";
import { useExplorer } from "../store.ts";

/** Children shown per element before "… N more". */
const MAX_CHILDREN = 40;

/** Collapsible JSX render tree including native elements, props and render conditions. */
export function RenderTree({ nodes }: { nodes: JsxNode[] }) {
  return (
    <Box fontFamily="mono" fontSize="xs">
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

  return (
    <Box>
      {node.conditions.length > 0 && (
        <Flex gap="1" wrap="wrap" pl={`${depth * 14 + 18}px`} pt="1">
          {node.conditions.map((c, i) => (
            <Tooltip key={i} content={`${c.kind}: ${c.expr}`}>
              <CodeChip colorPalette={c.kind === "map" ? "purple" : c.kind === "prop" ? "gray" : "orange"}>
                <Text as="span" fontWeight="semibold" mr="1">
                  {CONDITION_LABEL[c.kind]}
                </Text>
                {formatCondition(c)}
              </CodeChip>
            </Tooltip>
          ))}
        </Flex>
      )}
      <Flex align="center" gap="1" pl={`${depth * 14}px`} py="0.5" _hover={{ bg: "bg.muted" }} rounded="sm">
        <Box
          as="button"
          w="4"
          color="fg.muted"
          visibility={hasChildren ? "visible" : "hidden"}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </Box>
        <Text
          as="button"
          color={node.native ? "fg.muted" : target ? `kind.${target.kind}.fg` : "fg"}
          fontWeight={node.native ? "normal" : "semibold"}
          textDecoration={target && target.kind !== "external" ? "underline dotted" : undefined}
          onClick={() => {
            if (target) addNodes([target.id], { select: target.id, focus: target.id, anchor: useExplorer.getState().selectedId });
            else setShowProps((s) => !s);
          }}
          title={target ? `Add ${target.name} to the diagram` : "Toggle props"}
        >
          {"<"}
          {node.tag}
          {">"}
        </Text>
        {node.props.length > 0 && (
          <Text as="button" color="fg.subtle" onClick={() => setShowProps((s) => !s)}>
            {showProps ? "▾" : "▸"} {node.props.length} prop{node.props.length > 1 ? "s" : ""}
          </Text>
        )}
        <Text color="fg.subtle" ml="auto">
          :{node.loc.line}
        </Text>
      </Flex>
      {showProps && (
        <Box pl={`${depth * 14 + 22}px`} pb="1">
          {node.props.map((p, i) => (
            <Text key={i} color="fg.muted" wordBreak="break-all">
              <Text as="span" color="fg">
                {p.name}
              </Text>
              {p.isSpread ? "" : `=${p.value}`}
            </Text>
          ))}
        </Box>
      )}
      {open && (all ? node.children : node.children.slice(0, MAX_CHILDREN)).map((c, i) => <RenderTreeNode key={i} node={c} depth={depth + 1} />)}
      {open && !all && node.children.length > MAX_CHILDREN && (
        <Text as="button" pl={`${(depth + 1) * 14 + 18}px`} color="fg.muted" onClick={() => setAll(true)}>
          … {node.children.length - MAX_CHILDREN} more
        </Text>
      )}
    </Box>
  );
}
