import { Alert, Box, Button, chakra, Flex, HStack, Input, Modal, Spinner, Stack, SwitchField, Text, textPx } from "@rae/design-system";
import { IconBranch, IconChevronRight, IconFile, IconFolder, IconParentDir, IconScan } from "@rae/design-system/icons";
import type { GitRepo } from "@rae/schema";
import { useEffect, useState } from "react";
import { fetchGit, type FsListing, listDir } from "../lib/api.ts";
import { remoteLabel } from "../lib/branches.ts";
import { projectName, shortPath } from "../lib/paths.ts";
import { isScanning, readMergeSetting, SCAN_MERGE_KEY as MERGE_KEY, SCAN_PATH_KEY as LAST_PATH_KEY, startScan } from "../lib/scanJob.ts";
import { readSetting, writeSetting } from "../lib/settings.ts";
import { useExplorer } from "../store.ts";
import { type CompareChoice, CompareOptions } from "./CompareOptions.tsx";

export interface ScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new snapshot file once its structure is scanned (types follow in the background). */
  onScanned: (file: string) => void;
}

/** Remembered per repo: scan origin's newest commit rather than the checkout. */
const LATEST_KEY = (root: string) => `rae.scanLatest:${root}`;

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
 * Pick a folder (or entry file) on the server's machine and scan it. The folder you're in is what
 * gets scanned (the footer and the button name it): no separate "use this folder" step. A file
 * clicked in the list becomes the target instead (an entry file). In a git repo with an origin,
 * "Latest from origin" scans origin's newest commit of the default branch, fetched and exported:
 * the checkout isn't touched.
 */
export function ScanModal({ open, onOpenChange, onScanned }: ScanModalProps) {
  const [types, setTypes] = useState(true);
  // remembered: whether files declaring one exported thing become that declaration (default on)
  const [merge, setMerge] = useState(readMergeSetting);
  const [diff, setDiff] = useState<CompareChoice>();
  const [listing, setListing] = useState<FsListing>();
  // an entry file picked in the list (else the open folder is scanned)
  const [file, setFile] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  const [browseError, setBrowseError] = useState<string>();
  const [repoFor, setRepoFor] = useState<{ key: string; repo: GitRepo | null }>();
  const [latestPicked, setLatestPicked] = useState<Record<string, boolean>>({});
  // Compare and "Latest from origin" exclude each other: turning one on turns the other off
  const [compareOn, setCompareOn] = useState(false);
  // progress, cancelling and errors live in the panel over the canvas (ScanProgress)
  const scanning = isScanning(useExplorer((s) => s.scan));

  const folder = listing?.path;
  const target = file ?? folder ?? "";
  const repo = folder && repoFor?.key === folder ? repoFor.repo : undefined;
  const canLatest = !!repo?.remote && !!repo.defaultBranch;
  const latest = canLatest && !compareOn && (latestPicked[repo!.root] ?? readSetting(LATEST_KEY(repo!.root), false));
  const pickLatest = (root: string, on: boolean) => {
    setLatestPicked((m) => ({ ...m, [root]: on }));
    writeSetting(LATEST_KEY(root), on);
  };

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

  // the open folder's git repo (for "Latest from origin"), a moment after browsing stops
  useEffect(() => {
    if (!open || !folder) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetchGit(folder)
        .then((g) => !cancelled && setRepoFor({ key: folder, repo: g.repo }))
        .catch(() => !cancelled && setRepoFor({ key: folder, repo: null }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, folder]);

  const scan = () => {
    if (!target) return;
    writeSetting(LAST_PATH_KEY, target);
    writeSetting(MERGE_KEY, merge);
    void startScan(target, { types, merge, diff, latest }, onScanned);
    onOpenChange(false); // progress (and Cancel) show over the canvas: nothing blocks while it runs
  };

  const kind = listing && projectKind(listing.markers);
  const name = target ? projectName(target) : "";
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Scan a project"
      size="lg"
      footer={
        <HStack w="full" gap="3">
          <Box flex="1" minW="0" fontSize={textPx(12)} color="fg.muted">
            {target && (
              <>
                {diff ? "Will compare" : latest ? `Will scan origin/${repo!.defaultBranch} of` : "Will scan"}
                <Text fontFamily="mono" color="fg" truncate title={target}>
                  {shortPath(target)}
                </Text>
              </>
            )}
          </Box>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button colorPalette="accent" onClick={scan} disabled={!target || scanning} maxW="260px" title={scanning ? "A scan is running — cancel it in the progress panel first" : undefined}>
            {scanning ? <Spinner size="xs" /> : <IconScan size={16} />}
            <Text as="span" truncate>
              {scanning ? "Scanning…" : diff ? "Compare" : `Scan ${name}`}
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
                <Text color="fg.subtle">No package.json here. Open a project folder below, or scan this one anyway.</Text>
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
                  title={file === e.path ? "Scanning from this entry file: click again to scan the folder" : "Scan from this entry file"}
                  onClick={() => setFile(file === e.path ? undefined : e.path)}
                />
              ),
            )}
          </Box>
        </Box>

        {/* everything git: the repo, the latest from origin, comparing commits */}
        {repo ? (
          <Stack gap="0" borderWidth="1px" borderColor={diff ? "diff.changed.solid" : "border"} rounded="md" overflow="hidden">
            <Flex align="center" gap="2" px="3" h="34px" bg="bg.subtle" borderBottomWidth="1px" borderColor="border" fontSize={textPx(12)} minW="0">
              <Box color="fg.subtle" display="inline-flex">
                <IconBranch size={14} />
              </Box>
              <Text fontWeight="semibold">Git</Text>
              <Text color="fg.muted" truncate minW="0" title={repo.root}>
                {repo.branch ? (
                  <>
                    on{" "}
                    <Text as="span" fontFamily="mono" color="fg">
                      {repo.branch}
                    </Text>
                  </>
                ) : (
                  `detached at ${repo.head.slice(0, 7)}`
                )}
                {repo.dirty ? " · uncommitted changes" : ""}
              </Text>
              {repo.remote && (
                <Text ml="auto" fontFamily="mono" fontSize={textPx(11)} color="fg.subtle" truncate minW="0" title={repo.remote.url}>
                  {remoteLabel(repo.remote.url)}
                </Text>
              )}
            </Flex>
            {canLatest && (
              <Box px="3" py="2.5" borderBottomWidth="1px" borderColor="border">
                <Option
                  label={`Latest from origin/${repo.defaultBranch}`}
                  hint={`Fetches origin/${repo.defaultBranch} and scans its newest commit from a temporary copy. Your checkout isn't touched.`}
                  checked={latest}
                  onChange={(on) => {
                    pickLatest(repo.root, on);
                    if (on) setCompareOn(false);
                  }}
                />
              </Box>
            )}
            <CompareOptions
              path={target}
              onChange={setDiff}
              embedded
              on={compareOn}
              onOnChange={(on) => {
                setCompareOn(on);
                if (on && latest) pickLatest(repo.root, false);
              }}
            />
          </Stack>
        ) : (
          <CompareOptions path={target} onChange={setDiff} />
        )}

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
