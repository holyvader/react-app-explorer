import { Alert, Badge, Box, Button, Code, Flex, HStack, Input, Modal, ProgressBar, Spinner, Stack, Switch, Text } from "@rae/design-system";
import { IconFile, IconFolder, IconParentDir, IconScan } from "@rae/design-system/icons";
import { useEffect, useState } from "react";
import { type FsListing, listDir } from "../lib/api.ts";
import { dismissScan, startScan } from "../lib/scanJob.ts";
import { type ScanState, useExplorer } from "../store.ts";

/** The structure phase as a label and a bar value (null = indeterminate). */
function structureProgress(scan: ScanState): { label: string; value: number | null } {
  if (scan.stage === "parse" && scan.total) return { label: `Parsing ${scan.done ?? 0} / ${scan.total} files`, value: Math.round(((scan.done ?? 0) / scan.total) * 95) };
  if (scan.stage === "graph") return { label: "Building the diagram…", value: 97 };
  return { label: "Finding files…", value: null };
}

const LAST_PATH_KEY = "rae.scanPath";

export interface ScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new snapshot file once its structure is scanned (types follow in the background). */
  onScanned: (file: string) => void;
}

/** Pick a folder or entry file on the dev server's machine and run the scanner on it. */
export function ScanModal({ open, onOpenChange, onScanned }: ScanModalProps) {
  const [path, setPath] = useState(() => localStorage.getItem(LAST_PATH_KEY) ?? "");
  const [types, setTypes] = useState(true);
  const [listing, setListing] = useState<FsListing>();
  const [browseError, setBrowseError] = useState<string>();
  const scanState = useExplorer((s) => s.scan);
  // this dialog owns the structure phase; the type pass shows on the canvas
  const scanning = scanState?.phase === "structure";
  const failed = scanState?.phase === "failed" ? scanState.message : undefined;
  const typing = scanState?.phase === "types";

  const browse = (dir?: string) => {
    setBrowseError(undefined);
    listDir(dir)
      .then(setListing)
      .catch((e: Error) => setBrowseError(e.message));
  };

  // Load the initial listing when the dialog opens (an external system → effect is appropriate).
  useEffect(() => {
    if (!open) return;
    if (useExplorer.getState().scan?.phase === "failed") dismissScan(); // a fresh start, not the last error
    const start = localStorage.getItem(LAST_PATH_KEY) ?? undefined;
    let cancelled = false;
    listDir(start)
      .catch(() => listDir())
      .then((l) => !cancelled && setListing(l))
      .catch((e: Error) => !cancelled && setBrowseError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const scan = () => {
    const target = path.trim();
    localStorage.setItem(LAST_PATH_KEY, target);
    void startScan(target, types, (file) => {
      onScanned(file);
      onOpenChange(false); // the diagram is ready; types finish in the background
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !scanning && onOpenChange(o)}
      title="Scan a project"
      size="lg"
      footer={
        <HStack w="full">
          <Switch checked={types} onCheckedChange={setTypes} disabled={scanning}>
            Type info (TypeScript 7)
          </Switch>
          <Box flex="1" />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={scanning}>
            Close
          </Button>
          <Button onClick={scan} disabled={!path.trim() || scanning || typing} title={typing ? "Wait until the last scan's types are added" : undefined}>
            {scanning || typing ? <Spinner size="xs" /> : <IconScan size={16} />} {typing ? "Adding types…" : "Scan"}
          </Button>
        </HStack>
      }
    >
      <Stack gap="3">
        <Stack gap="1">
          <Text fontSize="sm" fontWeight="medium">
            Folder or entry file
          </Text>
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && path.trim() && !scanning && void scan()}
            placeholder="/path/to/app  or  /path/to/app/src/main.tsx"
            fontFamily="mono"
            size="sm"
          />
        </Stack>

        <Box borderWidth="1px" borderColor="border" rounded="md">
          <Flex align="center" gap="2" px="2" py="1.5" borderBottomWidth="1px" borderColor="border" bg="bg.subtle">
            <Button size="2xs" variant="ghost" disabled={!listing?.parent} onClick={() => listing?.parent && browse(listing.parent)} aria-label="Parent folder">
              <IconParentDir size={14} />
            </Button>
            <Text fontSize="xs" fontFamily="mono" truncate flex="1" title={listing?.path}>
              {listing?.path ?? "…"}
            </Text>
            {listing?.markers.map((m) => (
              <Badge key={m} size="xs" variant="outline">
                {m}
              </Badge>
            ))}
            <Button size="2xs" onClick={() => listing && setPath(listing.path)} disabled={!listing}>
              Use this folder
            </Button>
          </Flex>
          <Box maxH="300px" overflowY="auto" py="1">
            {browseError && (
              <Text px="3" py="2" fontSize="xs" color="red.fg">
                {browseError}
              </Text>
            )}
            {listing?.entries.length === 0 && (
              <Text px="3" py="2" fontSize="xs" color="fg.muted">
                No folders or source files here.
              </Text>
            )}
            {listing?.entries.map((e) => (
              <Flex
                key={e.path}
                as="button"
                w="full"
                align="center"
                gap="2"
                px="3"
                py="1"
                fontSize="sm"
                textAlign="left"
                bg={path === e.path ? "bg.emphasized" : undefined}
                _hover={{ bg: "bg.muted" }}
                onClick={() => (e.kind === "dir" ? browse(e.path) : setPath(e.path))}
                onDoubleClick={() => setPath(e.path)}
                title={e.kind === "dir" ? "Open folder (double-click to select it)" : "Select as entry file"}
              >
                <Box color={e.kind === "dir" ? "kind.module.fg" : "kind.component.fg"}>
                  {e.kind === "dir" ? <IconFolder size={14} /> : <IconFile size={14} />}
                </Box>
                <Text truncate>{e.name}</Text>
              </Flex>
            ))}
          </Box>
        </Box>

        {scanning && scanState && (
          <Stack gap="1.5">
            <HStack fontSize="sm" color="fg.muted" justify="space-between">
              <Text truncate>{structureProgress(scanState).label}</Text>
              <Text fontFamily="mono" fontSize="xs" truncate maxW="50%" title={scanState.path}>
                {scanState.path}
              </Text>
            </HStack>
            <ProgressBar value={structureProgress(scanState).value} size="sm" label="Scan progress" />
          </Stack>
        )}
        {failed && (
          <Alert status="error" title="Scan failed">
            <Code display="block" whiteSpace="pre-wrap" fontSize="2xs" mt="1" maxH="160px" overflowY="auto" bg="transparent">
              {failed}
            </Code>
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
