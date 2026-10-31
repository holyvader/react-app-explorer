import { Alert, Badge, Box, Button, Code, Flex, HStack, Input, Modal, Spinner, Stack, Switch, Text } from "@rae/design-system";
import { IconFile, IconFolder, IconParentDir, IconScan } from "@rae/design-system/icons";
import { useEffect, useState } from "react";
import { type FsListing, listDir, runScan, type ScanResult } from "../lib/api.ts";

const LAST_PATH_KEY = "rae.scanPath";

export interface ScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new snapshot file name after a successful scan. */
  onScanned: (file: string | undefined) => void;
}

/** Pick a folder or entry file on the dev server's machine and run the scanner on it. */
export function ScanModal({ open, onOpenChange, onScanned }: ScanModalProps) {
  const [path, setPath] = useState(() => localStorage.getItem(LAST_PATH_KEY) ?? "");
  const [types, setTypes] = useState(true);
  const [listing, setListing] = useState<FsListing>();
  const [browseError, setBrowseError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<{ ok: true; r: ScanResult } | { ok: false; error: string }>();

  const browse = (dir?: string) => {
    setBrowseError(undefined);
    listDir(dir)
      .then(setListing)
      .catch((e: Error) => setBrowseError(e.message));
  };

  // Load the initial listing when the dialog opens (an external system → effect is appropriate).
  useEffect(() => {
    if (!open) return;
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

  const scan = async () => {
    setScanning(true);
    setResult(undefined);
    try {
      const r = await runScan(path.trim(), types);
      localStorage.setItem(LAST_PATH_KEY, path.trim());
      setResult({ ok: true, r });
      onScanned(r.file);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setScanning(false);
    }
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
          <Button onClick={scan} disabled={!path.trim() || scanning}>
            {scanning ? <Spinner size="xs" /> : <IconScan size={16} />} Scan
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

        {scanning && (
          <HStack fontSize="sm" color="fg.muted">
            <Spinner size="sm" /> <Text>Scanning {path}…</Text>
          </HStack>
        )}
        {result?.ok === true && (
          <Alert status="success" title={`Scanned in ${result.r.ms < 1000 ? `${result.r.ms}ms` : `${(result.r.ms / 1000).toFixed(1)}s`}, snapshot loaded`}>
            <Code display="block" whiteSpace="pre-wrap" fontSize="2xs" mt="1" bg="transparent">
              {result.r.stdout.split("\n")[0]}
            </Code>
          </Alert>
        )}
        {result?.ok === false && (
          <Alert status="error" title="Scan failed">
            <Code display="block" whiteSpace="pre-wrap" fontSize="2xs" mt="1" maxH="160px" overflowY="auto" bg="transparent">
              {result.error}
            </Code>
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
