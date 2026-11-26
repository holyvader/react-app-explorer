import { Alert, Box, Button, chakra, Flex, HStack, Input, Modal, Spinner, Stack, SwitchField, Text, textPx } from "@rae/design-system";
import { IconChevronRight, IconFile, IconFolder, IconFolderOpen, IconParentDir } from "@rae/design-system/icons";
import { useEffect, useState } from "react";
import { type FsListing, listDir } from "../lib/api.ts";
import { projectName, shortPath } from "../lib/paths.ts";
import { pruneOlder } from "../lib/projects.ts";
import { isScanning, readMergeSetting, SCAN_MERGE_KEY as MERGE_KEY, SCAN_PATH_KEY as LAST_PATH_KEY, startScan } from "../lib/scanJob.ts";
import { readSetting, writeSetting } from "../lib/settings.ts";
import { useExplorer } from "../store.ts";

export interface ScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new snapshot file once its structure is scanned (types follow in the background). */
  onScanned: (file: string) => void;
}

const parentOf = (p: string) => p.replace(/[\\/][^\\/]+[\\/]?$/, "") || "/";
const HOME = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/;

/** A path as clickable parts, the home folder as `~`: [{ label, path }]. */
function crumbsOf(path: string): { label: string; path: string }[] {
  const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
  const home = path.match(HOME)?.[1];
  const rest = home ? path.slice(home.length) : path;
  const parts = rest.split(/[\\/]/).filter(Boolean);
  const crumbs = home ? [{ label: "~", path: home }] : [{ label: sep === "/" ? "/" : parts.shift()!, path: sep === "/" ? "/" : rest.split(sep)[0]! + sep }];
  let at = crumbs[0]!.path;
  for (const p of parts) {
    at = at.endsWith(sep) ? at + p : at + sep + p;
    crumbs.push({ label: p, path: at });
  }
  return crumbs;
}

/** What the open folder is, from the files in it. */
function projectKind(markers: string[]): "Next.js" | "Project" | undefined {
  if (markers.some((m) => m.startsWith("next.config."))) return "Next.js";
  return markers.includes("package.json") ? "Project" : undefined;
}

/**
 * Pick a folder (or entry file) on this machine and open it. The folder you're in is what opens
 * (the footer and the button name it): no separate "use this folder" step. A file clicked in the
 * list becomes the target instead (an entry file). Git (the latest from origin, comparing) is in
 * the top bar (git/GitControls.tsx), on the open project.
 */
export function ScanModal({ open, onOpenChange, onScanned }: ScanModalProps) {
  // remembered: whether files declaring one exported thing become that declaration (default on)
  const [merge, setMerge] = useState(readMergeSetting);
  const [listing, setListing] = useState<FsListing>();
  // an entry file picked in the list (else the open folder is scanned)
  const [file, setFile] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  const [browseError, setBrowseError] = useState<string>();
  // progress, cancelling and errors live in the panel over the canvas (ScanProgress)
  const scanning = isScanning(useExplorer((s) => s.scan));

  const folder = listing?.path;
  const target = file ?? folder ?? "";

  const browse = (dir?: string) => {
    setBrowseError(undefined);
    listDir(dir)
      .then((l) => {
        setListing(l);
        setFile(undefined);
        setEditing(false);
      })
      .catch((e: Error) => setBrowseError(e.message));
  };

  // the initial listing when the dialog opens: the last scanned folder (its parent, if it was a file)
  useEffect(() => {
    if (!open) return;
    const start = readSetting(LAST_PATH_KEY, "") || undefined;
    let cancelled = false;
    listDir(start)
      .then((l) => ({ l, f: undefined as string | undefined }))
      .catch(() => (start ? listDir(parentOf(start)).then((l) => ({ l, f: l.entries.some((e) => e.path === start && e.kind === "file") ? start : undefined })) : Promise.reject(new Error())))
      .catch(() => listDir().then((l) => ({ l, f: undefined })))
      .then(({ l, f }) => {
        if (cancelled) return;
        setListing(l);
        setFile(f);
      })
      .catch((e: Error) => !cancelled && setBrowseError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const scan = () => {
    if (!target) return;
    writeSetting(LAST_PATH_KEY, target);
    writeSetting(MERGE_KEY, merge);
    // once read completely, the older snapshots of the same project view go (one cached per view)
    // type info is always read (after the structure is shown)
    void startScan(target, { types: true, merge }, onScanned).then((o) => (o.ok && o.file ? pruneOlder(o.file) : undefined));
    onOpenChange(false); // progress (and Cancel) show over the canvas: nothing blocks while it runs
  };

  const kind = listing && projectKind(listing.markers);
  const name = target ? projectName(target) : "";
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Open project"
      size="lg"
      footer={
        <HStack w="full" gap="3">
          <Box flex="1" minW="0" fontSize={textPx(12)} color="fg.muted">
            {target && (
              <>
                Will open
                <Text fontFamily="mono" color="fg" truncate title={target}>
                  {shortPath(target)}
                </Text>
              </>
            )}
          </Box>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button colorPalette="accent" onClick={scan} disabled={!target || scanning} maxW="260px" title={scanning ? "A project is opening — cancel it in the progress panel first" : undefined}>
            {scanning ? <Spinner size="xs" /> : <IconFolderOpen size={16} />}
            <Text as="span" truncate>
              {scanning ? "Opening…" : `Open ${name}`}
            </Text>
          </Button>
        </HStack>
      }
    >
      <Stack gap="3">
        <Box borderWidth="1px" borderColor="border" rounded="md" overflow="hidden">
          {/* where you are: click a part to go up, or type / paste a path */}
          {editing ? (
            <Flex
              as="form"
              align="center"
              gap="2"
              px="2"
              py="1.5"
              borderBottomWidth="1px"
              borderColor="border"
              bg="bg.subtle"
              onSubmit={(e: React.FormEvent) => {
                e.preventDefault();
                const p = typed.trim();
                if (!p) return;
                // a file: open its folder and pick it as the entry file
                listDir(p)
                  .then(() => browse(p))
                  .catch(() =>
                    listDir(parentOf(p))
                      .then((l) => {
                        if (!l.entries.some((x) => x.path === p && x.kind === "file")) throw new Error(`Not found: ${p}`);
                        setListing(l);
                        setFile(p);
                        setEditing(false);
                      })
                      .catch((err: Error) => setBrowseError(err.message)),
                  );
              }}
            >
              <Input autoFocus size="xs" fontFamily="mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="/path/to/app  or  /path/to/app/src/main.tsx" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setEditing(false))} />
              <Button size="2xs" type="submit">
                Go
              </Button>
              <Button size="2xs" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </Flex>
          ) : (
            <Flex align="center" gap="0.5" px="2" h="34px" borderBottomWidth="1px" borderColor="border" bg="bg.subtle" fontFamily="mono" fontSize={textPx(12)} overflowX="auto" whiteSpace="nowrap">
              {listing &&
                crumbsOf(listing.path).map((c, i, all) => (
                  <Flex key={c.path} align="center" gap="0.5" flexShrink={0}>
                    {i > 0 && (
                      <Box color="fg.subtle" display="inline-flex">
                        <IconChevronRight size={12} />
                      </Box>
                    )}
                    <chakra.button
                      type="button"
                      px="1.5"
                      py="0.5"
                      rounded="sm"
                      cursor="pointer"
                      color={i === all.length - 1 ? "fg" : "fg.muted"}
                      fontWeight={i === all.length - 1 ? "semibold" : "normal"}
                      _hover={{ bg: "bg.muted", color: "fg" }}
                      onClick={() => browse(c.path)}
                    >
                      {c.label}
                    </chakra.button>
                  </Flex>
                ))}
              <Box flex="1" />
              <Button
                size="2xs"
                variant="ghost"
                fontFamily="body"
                color="fg.muted"
                flexShrink={0}
                onClick={() => {
                  setTyped(file ?? listing?.path ?? "");
                  setEditing(true);
                }}
              >
                Edit path
              </Button>
            </Flex>
          )}
          {/* is this a project? (so going one level too deep, into app/, shows) */}
          {listing && (
            <Flex align="center" gap="2.5" px="3" py="2" borderBottomWidth="1px" borderColor="border" bg={kind ? "kind.type.subtle" : undefined} fontSize={textPx(12.5)}>
              {kind ? (
                <>
                  <Text flex="1" minW="0">
                    <Text as="span" fontWeight="semibold">
                      {projectName(listing.path)}
                    </Text>{" "}
                    is a project
                    <Text as="span" color="fg.subtle">
                      {" "}
                      · {listing.markers.join(", ")}
                    </Text>
                  </Text>
                  <ProjectBadge kind={kind} />
                </>
              ) : (
                <Text color="fg.subtle">No package.json here. Choose a project folder below, or open this one anyway.</Text>
              )}
            </Flex>
          )}
          <Box maxH="300px" overflowY="auto" p="1">
            {browseError && (
              <Text px="3" py="2" fontSize="xs" color="red.fg">
                {browseError}
              </Text>
            )}
            {listing?.parent && <Row icon={<IconParentDir size={14} />} name=".." title="Parent folder" onClick={() => browse(listing.parent!)} />}
            {listing?.entries.length === 0 && (
              <Text px="3" py="2" fontSize="xs" color="fg.muted">
                No folders or source files here.
              </Text>
            )}
            {listing?.entries.map((e) =>
              e.kind === "dir" ? (
                <Row key={e.path} icon={<IconFolder size={14} />} name={e.name} title="Open folder" onClick={() => browse(e.path)} chevron badge={e.project && <ProjectBadge kind={e.project === "next" ? "Next.js" : "Project"} />} />
              ) : (
                <Row
                  key={e.path}
                  icon={<IconFile size={14} />}
                  name={e.name}
                  muted
                  selected={file === e.path}
                  title={file === e.path ? "Starting from this entry file: click again to use the whole folder" : "Start from this entry file"}
                  onClick={() => setFile(file === e.path ? undefined : e.path)}
                />
              ),
            )}
          </Box>
        </Box>

        <Stack gap="2.5" borderWidth="1px" borderColor="border" rounded="md" px="3" py="2.5">
          <Option
            label="Merge single-export files"
            hint="A file that declares one thing and exports it shows as that element (page.tsx → BlogPost, with its page / server badges)."
            checked={merge}
            onChange={setMerge}
          />
        </Stack>

        {scanning && (
          <Alert status="info" title="A project is opening">
            Its progress is shown over the diagram, where you can cancel it.
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}

function ProjectBadge({ kind }: { kind: "Next.js" | "Project" }) {
  return (
    <Text as="span" fontSize={textPx(10.5)} fontWeight="medium" px="1.5" rounded="sm" borderWidth="1px" borderColor="kind.type.muted" color="kind.type.fg" whiteSpace="nowrap" flexShrink={0}>
      {kind}
    </Text>
  );
}

function Row(props: { icon: React.ReactNode; name: string; title: string; onClick: () => void; chevron?: boolean; muted?: boolean; selected?: boolean; badge?: React.ReactNode }) {
  return (
    <Flex
      as="button"
      w="full"
      align="center"
      gap="2"
      px="2.5"
      py="1"
      rounded="sm"
      fontSize="sm"
      textAlign="left"
      cursor="pointer"
      bg={props.selected ? "selection.rowBg" : undefined}
      boxShadow={props.selected ? "inset 2px 0 0 var(--chakra-colors-selection-solid)" : undefined}
      _hover={{ bg: props.selected ? "selection.rowBg" : "bg.muted" }}
      onClick={props.onClick}
      title={props.title}
    >
      <Box color="fg.subtle" display="inline-flex">
        {props.icon}
      </Box>
      <Text flex="1" minW="0" truncate color={props.muted && !props.selected ? "fg.muted" : undefined}>
        {props.name}
      </Text>
      {props.badge}
      {props.chevron && (
        <Box color="fg.subtle" display="inline-flex">
          <IconChevronRight size={13} />
        </Box>
      )}
    </Flex>
  );
}

function Option({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return <SwitchField size="sm" label={<Text fontSize="sm">{label}</Text>} ariaLabel={label} hint={hint} checked={checked} onCheckedChange={onChange} disabled={disabled} />;
}
