import { Box, Button, Flex, ProgressBar, Spinner, Text } from "@rae/design-system";
import { IconClose, IconDone, IconWarning } from "@rae/design-system/icons";
import { type ReactNode, useEffect, useState } from "react";
import { cancelScan, dismissScan, isScanning } from "../lib/scanJob.ts";
import { type ScanState, useExplorer } from "../store.ts";

const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

type Row = { status: "waiting" | "active" | "done" | "off"; value: number | null; text: string };

/** The files step: real counts — parsed vs. found so far (more turn up as imports are followed). */
function filesRow(scan: ScanState): Row {
  const p = scan.parse;
  if (scan.phase !== "structure") {
    // stopped or failed before the structure was written: say so, with how far it got
    if (!scan.file) return { status: "off", value: 0, text: `${scan.phase === "cancelled" ? "Stopped" : "Failed"}${p ? ` at ${p.done} / ${p.total}` : ""}` };
    return { status: "done", value: 100, text: p ? `${p.total} files scanned` : "Scanned" };
  }
  if (scan.stage === "graph") return { status: "active", value: 100, text: `${p?.total ?? 0} files scanned · building the diagram` };
  if (!p) return { status: "active", value: null, text: "Finding files…" };
  return { status: "active", value: pct(p.done, p.total), text: `${p.done} / ${p.total} scanned · ${p.total - p.done} left` };
}

/** The types step: TypeScript loading the project (no per-file count, so a timer), then real counts. */
function typesRow(scan: ScanState, now: number): Row {
  if (!scan.withTypes) return { status: "off", value: 0, text: "Off" };
  const t = scan.types;
  if (scan.phase === "structure") return { status: "waiting", value: 0, text: "Starts when files are scanned" };
  if (scan.phase === "typed")
    return scan.typed === false
      ? { status: "off", value: 0, text: "Not added (see below)" }
      : { status: "done", value: 100, text: t?.total ? `${t.total} files typed` : "Up to date (cached)" };
  if (scan.phase === "cancelled" || scan.phase === "failed") return { status: "off", value: t ? pct(t.done, t.total) : 0, text: scan.phase === "cancelled" ? "Stopped" : "Not added" };
  if (!t || t.loading) return { status: "active", value: null, text: `Loading the project into TypeScript… ${t ? secs(now - t.since) : ""}` };
  return { status: "active", value: pct(t.done, t.total), text: `${t.done} / ${t.total} typed · ${t.total - t.done} left` };
}

function StepRow({ label, row }: { label: string; row: Row }) {
  const icon: ReactNode =
    row.status === "done" ? (
      <Box color="green.fg" display="inline-flex">
        <IconDone size={13} />
      </Box>
    ) : row.status === "active" ? (
      <Spinner size="xs" />
    ) : (
      <Box w="3" h="3" rounded="full" borderWidth="1.5px" borderColor="border.emphasized" />
    );
  return (
    <Box>
      <Flex align="center" gap="2" mb="1">
        <Box w="3.5" display="inline-flex" justifyContent="center" flexShrink={0}>
          {icon}
        </Box>
        <Text fontSize="xs" fontWeight="semibold" w="12" flexShrink={0}>
          {label}
        </Text>
        <Text fontSize="xs" color="fg.muted" flex="1" truncate fontVariantNumeric="tabular-nums">
          {row.text}
        </Text>
      </Flex>
      {row.status !== "off" && (
        <Box pl="5.5">
          <ProgressBar value={row.status === "waiting" ? 0 : row.value} colorPalette={row.status === "done" ? "green" : "component"} label={`${label} progress`} />
        </Box>
      )}
    </Box>
  );
}

/**
 * A scan's progress over the canvas, from start to finish: files scanned vs. left, then TypeScript
 * loading and files typed vs. left. Cancel stops it at any point; the diagram stays usable meanwhile.
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
  if (!scan) return null;

  const name = scan.path.split(/[\\/]/).filter(Boolean).pop() ?? scan.path;
  const problem = scan.phase === "failed" || (scan.phase === "typed" && scan.typed === false);
  const title = running
    ? `Scanning ${name}`
    : scan.phase === "cancelled"
      ? "Scan cancelled"
      : scan.phase === "failed"
        ? "Scan failed"
        : problem
          ? "Diagram ready, without types"
          : "Scan finished";
  // the clock stops with the scan, so this freezes at the total time
  const elapsed = secs(Math.max(0, now - scan.startedAt));

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
        <Flex direction="column" gap="2.5">
          <StepRow label="Files" row={filesRow(scan)} />
          <StepRow label="Types" row={typesRow(scan, now)} />
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
