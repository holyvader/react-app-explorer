import { Badge, BoundaryChip, Box, Flex, Text } from "@rae/design-system";
import { IconFolder } from "@rae/design-system/icons";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { PADDING } from "../../graph/layout.ts";
import { KIND_META } from "../../lib/kinds.tsx";
import { NodeActions } from "./NodeActions.tsx";
import { FRAME_HANDLE, type FrameFlowNode, HIDDEN_HANDLE } from "./types.ts";

/**
 * A container drawn around what it holds: a file module (its declarations inside)
 * or a folder (files inside). Dragged by its header; what it holds moves with it.
 */
function FrameNodeImpl({ data, selected, width, height }: NodeProps<FrameFlowNode>) {
  const { node, element, refused } = data;
  const folder = element.kind === "folder";
  const Icon = folder ? IconFolder : KIND_META.module.icon;
  const accent = folder ? "fg.subtle" : "kind.module.solid";
  return (
    <Box
      w={`${width}px`}
      h={`${height}px`}
      rounded="lg"
      borderWidth={selected ? "2px" : "1.5px"}
      borderStyle={refused ? "dashed" : folder ? "dashed" : "solid"}
      borderColor={refused ? "red.solid" : selected ? accent : folder ? "border.emphasized" : "kind.module.muted"}
      bg={refused ? "red.subtle/40" : folder ? "bg.subtle/50" : "kind.module.subtle/60"}
      position="relative"
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <Flex
        className={FRAME_HANDLE}
        h={`${PADDING.top - 12}px`}
        align="center"
        gap="2"
        px="3"
        cursor="grab"
        borderBottomWidth="1px"
        borderColor={folder ? "border" : "kind.module.muted"}
        bg={folder ? "transparent" : "bg.panel/70"}
        roundedTop="lg"
      >
        <Box color={folder ? "fg.muted" : "kind.module.fg"} flexShrink={0}>
          <Icon size={15} />
        </Box>
        <Box minW="0" flex="1">
          <Text fontWeight="semibold" fontSize="sm" truncate title={data.path ?? node?.filePath}>
            {element.name}
          </Text>
          {!folder && node && (
            <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate>
              {node.filePath}
            </Text>
          )}
        </Box>
        {node?.nextRole && (
          <Badge size="xs" variant="outline">
            {node.nextRole}
          </Badge>
        )}
        {node?.moduleType && <BoundaryChip boundary={node.moduleType} />}
        <NodeActions data={data} frame />
      </Flex>
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </Box>
  );
}

export const FrameNode = memo(FrameNodeImpl);
