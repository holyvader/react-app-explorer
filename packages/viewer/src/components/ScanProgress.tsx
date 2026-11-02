import { Box, Flex, ProgressBar, Spinner, Text } from "@rae/design-system";
import { IconClose, IconDone, IconWarning } from "@rae/design-system/icons";
import { dismissScan } from "../lib/scanJob.ts";
import { useExplorer } from "../store.ts";

/**
 * The background part of a scan, floating over the top of the canvas: the type pass's progress,
 * then "Types added" (or why they're missing). The structure phase shows in the scan dialog.
 */
export function ScanProgress() {
  const scan = useExplorer((s) => s.scan);
  if (!scan || scan.phase === "structure") return null;

  const typing = scan.phase === "types";
  const failed = scan.phase === "failed" || (scan.phase === "typed" && scan.typed === false);
  const value = typing && scan.total ? Math.round(((scan.done ?? 0) / scan.total) * 100) : typing ? null : 100;
  const label = typing
    ? scan.total
      ? `Adding types · ${scan.done ?? 0} / ${scan.total} files`
      : "Starting the type checker…"
    : failed
      ? scan.phase === "failed"
        ? "Scan failed"
        : "Diagram ready, without types"
      : "Types added";

  return (
    <Box position="absolute" top="3" left="50%" transform="translateX(-50%)" zIndex="1200" pointerEvents="auto" role="status" aria-live="polite">
      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        rounded="l3"
        shadow="md"
        px="3.5"
        py="2.5"
        minW="280px"
        maxW="460px"
        style={{ backdropFilter: "blur(8px)" }}
      >
        <Flex align="center" gap="2.5">
          <Box color={failed ? "orange.fg" : typing ? "fg.muted" : "green.fg"} display="inline-flex" flexShrink={0}>
            {typing ? <Spinner size="xs" /> : failed ? <IconWarning size={15} /> : <IconDone size={15} />}
          </Box>
          <Text fontSize="sm" fontWeight="medium" flex="1" truncate>
            {label}
          </Text>
          {!typing && (
            <Box as="button" aria-label="Dismiss" color="fg.muted" _hover={{ color: "fg" }} display="inline-flex" onClick={dismissScan}>
              <IconClose size={14} />
            </Box>
          )}
        </Flex>
        {typing && (
          <Box mt="2">
            <ProgressBar value={value} label="Type pass progress" />
          </Box>
        )}
        {failed && scan.message && (
          <Text mt="1.5" fontSize="xs" color="fg.muted" lineClamp={3} title={scan.message}>
            {scan.message}
          </Text>
        )}
      </Box>
    </Box>
  );
}
