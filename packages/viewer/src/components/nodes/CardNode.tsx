import { Badge, BoundaryChip, Box, Flex, HStack, Text } from "@rae/design-system";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { KIND_META } from "../../lib/kinds.tsx";
import { NodeActions } from "./NodeActions.tsx";
import { HIDDEN_HANDLE } from "./types.ts";
import type { CardFlowNode } from "./types.ts";

/** A single element: component, hook, function, action, external, or a file module with nothing drawn inside. */
function CardNodeImpl({ data, selected, width, height }: NodeProps<CardFlowNode>) {
  const { node, element } = data;
  if (!node) return null;
  const k = node.kind;
  const Icon = KIND_META[k].icon;
  return (
    <Box
      w={`${width}px`}
      h={`${height}px`}
      bg="bg.panel"
      borderWidth={selected ? "2px" : "1px"}
      borderColor={selected ? `kind.${k}.solid` : `kind.${k}.muted`}
      borderLeftWidth="4px"
      borderLeftColor={`kind.${k}.solid`}
      rounded="md"
      shadow={selected ? "lg" : "xs"}
      px="2.5"
      py="1.5"
      display="flex"
      flexDirection="column"
      justifyContent="space-between"
      title={node.filePath}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />
      <Flex align="center" gap="1.5" minW="0">
        <Box color={`kind.${k}.fg`} flexShrink={0}>
          <Icon size={14} />
        </Box>
        <Text fontWeight="semibold" fontSize="sm" truncate>
          {element.name}
        </Text>
        <Box flex="1" />
        {node.moduleType && element.parent === null && <BoundaryChip boundary={node.moduleType} />}
      </Flex>
      <Flex align="center" gap="1">
        <HStack gap="1" flex="1" minW="0" overflow="hidden">
          <Badge size="xs" bg={`kind.${k}.subtle`} color={`kind.${k}.fg`}>
            {KIND_META[k].label}
          </Badge>
          {node.nextRole && (
            <Badge size="xs" variant="outline">
              {node.nextRole}
            </Badge>
          )}
          {node.isAsync && (
            <Badge size="xs" variant="outline">
              async
            </Badge>
          )}
        </HStack>
        <NodeActions data={data} />
      </Flex>
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />
    </Box>
  );
}

export const CardNode = memo(CardNodeImpl);
