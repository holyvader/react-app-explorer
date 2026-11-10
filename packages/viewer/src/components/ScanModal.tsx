import { Alert, Badge, Box, Button, Flex, HStack, Input, Modal, Spinner, Stack, SwitchField, Text } from "@rae/design-system";
import { IconFile, IconFolder, IconParentDir, IconScan } from "@rae/design-system/icons";
import { useEffect, useState } from "react";
import { type FsListing, listDir } from "../lib/api.ts";
import { isScanning, startScan } from "../lib/scanJob.ts";
import { type CompareChoice, CompareOptions } from "./CompareOptions.tsx";
import { useExplorer } from "../store.ts";
import { readSetting, writeSetting } from "../lib/settings.ts";

const LAST_PATH_KEY = "rae.scanPath";
const MERGE_KEY = "rae.scanMerge";

export interface ScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new snapshot file once its structure is scanned (types follow in the background). */
  onScanned: (file: string) => void;
}

/** Pick a folder or entry file on the dev server's machine and run the scanner on it. */
export function ScanModal({ open, onOpenChange, onScanned }: ScanModalProps) {
  const [path, setPath] = useState(() => readSetting(LAST_PATH_KEY, ""));
  const [types, setTypes] = useState(true);
  // remembered: whether files declaring one exported thing become that declaration (default on)
  const [merge, setMerge] = useState(() => readSetting(MERGE_KEY, true, (raw) => raw !== "off"));
  const [diff, setDiff] = useState<CompareChoice>();
  const [listing, setListing] = useState<FsListing>();
  const [browseError, setBrowseError] = useState<string>();
  // progress, cancelling and errors live in the panel over the canvas (ScanProgress)
  const scanning = isScanning(useExplorer((s) => s.scan));

  const browse = (dir?: string) => {
    setBrowseError(undefined);
    listDir(dir)
      .then(setListing)
      .catch((e: Error) => setBrowseError(e.message));
  };

  // Load the initial listing when the dialog opens (an external system → effect is appropriate).
  useEffect(() => {
    if (!open) return;
    const start = readSetting(LAST_PATH_KEY, "") || undefined;
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
    writeSetting(LAST_PATH_KEY, target);
    writeSetting(MERGE_KEY, merge);
    void startScan(target, { types, merge, diff }, onScanned);
    onOpenChange(false); // progress (and Cancel) show over the canvas: nothing blocks while it runs
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Scan a project"
      size="lg"
      footer={
        <HStack w="full">
          <Box flex="1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button colorPalette="accent" onClick={scan} disabled={!path.trim() || scanning} title={scanning ? "A scan is running — cancel it in the progress panel first" : undefined}>
            {scanning ? <Spinner size="xs" /> : <IconScan size={16} />} {scanning ? "Scanning…" : diff ? "Compare" : "Scan"}
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
            onKeyDown={(e) => e.key === "Enter" && path.trim() && !scanning && scan()}
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

        <CompareOptions path={path} onChange={setDiff} />

        <Stack gap="2.5" borderWidth="1px" borderColor="border" rounded="md" px="3" py="2.5">
          <Option
            label="Merge single-export files"
            hint="A file that declares one thing and exports it shows as that element (page.tsx → BlogPost, with its page / server badges)."
            checked={merge}
            onChange={setMerge}
          />
          <Option label="Type info (TypeScript 7)" hint="Prop, parameter and return types. Runs after the structure is shown." checked={types} onChange={setTypes} />
        </Stack>

        {scanning && (
          <Alert status="info" title="A scan is running">
            Its progress is shown over the diagram, where you can cancel it.
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}

function Option({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <SwitchField size="sm" label={<Text fontSize="sm">{label}</Text>} ariaLabel={label} hint={hint} checked={checked} onCheckedChange={onChange} />
  );
}
