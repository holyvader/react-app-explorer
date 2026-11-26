import { Box, Button, Flex, ProgressBar, Spinner, Text } from "@rae/design-system";
import { IconClose, IconDone, IconWarning } from "@rae/design-system/icons";
import { useEffect, useState } from "react";
import { cancelScan, dismissScan, isScanning } from "../lib/scanJob.ts";
import { type ScanState, useExplorer } from "../store.ts";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

type Progress = { value: number | null; text: string; tone: "active" | "done" | "off" };

/**
 * One bar for the whole read: the files fill its first half (parsed vs. found so far — more turn up
 * as imports are followed), the types its second (TypeScript loading the project has no count, so
 * the bar waits at the middle with a timer, then files typed vs. left). The text says which step.
 */
function progressOf(scan: ScanState, now: number): Progress {
  const half = scan.withTypes ? 50 : 100;
  const p = scan.parse;
  const t = scan.types;
  const filesPart = p ? (p.done / Math.max(1, p.total)) * half : 0;
  if (scan.phase === "cancelled" || scan.phase === "failed") {
    const at = !scan.file ? filesPart : half + (t ? (t.done / Math.max(1, t.total)) * (100 - half) : 0);
    const where = !scan.file ? (p ? ` while reading files (${p.done} / ${p.total})` : "") : " while adding types";
    return { value: Math.round(at), text: `${scan.phase === "cancelled" ? "Stopped" : "Failed"}${where}`, tone: "off" };
  }
  if (scan.phase === "structure") {
    if (scan.stage === "graph") return { value: half, text: `Building the diagram · ${p?.total ?? 0} files`, tone: "active" };
    if (!p) return { value: null, text: "Finding files…", tone: "active" };
    return { value: Math.round(filesPart), text: `Reading files · ${p.done} / ${p.total}`, tone: "active" };
  }
  if (scan.phase === "typed") {
    const files = p ? ` · ${p.total} files` : "";
    return scan.typed === false ? { value: 100, text: `Ready, without types${files}`, tone: "off" } : { value: 100, text: `Ready${files}`, tone: "done" };
  }
  // types
  if (!t || t.loading) return { value: null, text: `Loading the project into TypeScript… ${t ? secs(now - t.since) : ""}`, tone: "active" };
  return { value: Math.round(half + (t.done / Math.max(1, t.total)) * (100 - half)), text: `Adding types · ${t.done} / ${t.total}`, tone: "active" };
}

/**
 * Opening a project, over the canvas, from start to finish: one bar (files read, then types added). Cancel stops it at any point; the diagram stays usable meanwhile.
 */
export function ScanProgress() {
  const scan = useExplorer((s) => s.scan);
  const running = isScanning(scan);
  const [now, setNow] = useState(() => Date.now());
  // a running clock for the steps without per-file counts (TypeScript loading the project)
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(t);
      setNow(Date.now()); // one last tick: the total time, even for scans shorter than a tick
    };
  }, [running]);
  // a quiet refresh (a cached copy on screen) shows only if it fails
  if (!scan || (scan.quiet && scan.phase !== "failed")) return null;

  const name = scan.path.split(/[\\/]/).filter(Boolean).pop() ?? scan.path;
  const problem = scan.phase === "failed" || (scan.phase === "typed" && scan.typed === false);
  const title = running
    ? `Opening ${name}`
    : scan.phase === "cancelled"
      ? "Opening cancelled"
      : scan.phase === "failed"
        ? `Couldn't open ${name}`
        : problem
          ? "Diagram ready, without types"
          : `Opened ${name}`;
  // the clock stops with the scan, so this freezes at the total time
  const elapsed = secs(Math.max(0, now - scan.startedAt));
  const progress = progressOf(scan, now);

  return (
    <Box position="absolute" top="3" left="50%" transform="translateX(-50%)" zIndex="1200" role="status" aria-live="polite">
      <Box bg="bg.panel" borderWidth="1px" borderColor="border.muted" rounded="l3" shadow="md" px="3.5" py="3" w="400px" maxW="calc(100vw - 32px)">
        <Flex align="center" gap="2.5" mb="2.5">
          {problem && (
            <Box color="orange.fg" display="inline-flex">
              <IconWarning size={15} />
            </Box>
          )}
          <Text fontSize="sm" fontWeight="semibold" flex="1" truncate title={scan.path}>
            {title}
          </Text>
          <Text fontSize="xs" color="fg.subtle" fontVariantNumeric="tabular-nums">
            {elapsed}
          </Text>
          {running ? (
            <Button size="2xs" variant="outline" onClick={cancelScan}>
              Cancel
            </Button>
          ) : (
            <Box as="button" aria-label="Dismiss" color="fg.muted" _hover={{ color: "fg" }} display="inline-flex" onClick={dismissScan}>
              <IconClose size={14} />
            </Box>
          )}
        </Flex>
        <ProgressBar value={progress.value} colorPalette={progress.tone === "done" ? "green" : "component"} label="Progress" />
        <Flex align="center" gap="2" mt="1.5">
          {progress.tone === "active" ? (
            <Spinner size="xs" />
          ) : progress.tone === "done" ? (
            <Box color="green.fg" display="inline-flex">
              <IconDone size={13} />
            </Box>
          ) : null}
          <Text fontSize="xs" color="fg.muted" flex="1" truncate fontVariantNumeric="tabular-nums">
            {progress.text}
          </Text>
        </Flex>
        {problem && scan.message && (
          <Text mt="2.5" fontSize="xs" color="fg.muted" lineClamp={4} whiteSpace="pre-wrap" wordBreak="break-word" title={scan.message} userSelect="text">
            {scan.message}
          </Text>
        )}
      </Box>
    </Box>
  );
}
