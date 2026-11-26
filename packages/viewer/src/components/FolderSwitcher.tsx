import { Box, Button, chakra, Flex, Kbd, Popover, Text, textPx } from "@rae/design-system";
import { IconFolder, IconFolderOpen, IconRescan, IconSearch, IconSettings } from "@rae/design-system/icons";
import { diffRequestOf, openView, read } from "../lib/projects.ts";
import type { Framework } from "@rae/schema";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { SnapshotList } from "../lib/api.ts";
import { expandHome, looksLikePath, scannedFolders } from "../lib/folders.ts";
import { projectName, shortPath } from "../lib/paths.ts";
import { useExplorer } from "../store.ts";

/** "today 14:02", else "3 Nov 14:02": a snapshot's moment, short. */

const FRAMEWORK: Record<Framework, string> = { "next-app": "Next.js", "next-pages": "Next.js", react: "React" };
const MOD = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl+";

export interface FolderSwitcherProps {
  list?: SnapshotList;
  /** Opens a folder or file right away, with the remembered settings (a pasted path). */
  onScanPath: (path: string) => void;
  /** The open dialog: browse for a folder. */
  onBrowse: () => void;
  /** Manage projects: remove the ones no longer needed. */
  onManage: () => void;
}

type Item = { key: string; run: () => void };

/**
 * The folder being explored, in the middle of the bar, like an editor's project switcher. Opens
 * (click or ⌘O) a search over the recently scanned folders: pick one to open its newest snapshot,
 * paste a path and press Enter to scan it, rescan the current one, browse, or manage projects.
 */
export function FolderSwitcher({ list, onScanPath, onBrowse, onManage }: FolderSwitcherProps) {
  const snapshot = useExplorer((s) => s.snapshot);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘O / Ctrl+O from anywhere (instead of the browser's "open file")
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setOpenAndReset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActive(0);
    }
  };
  const close = () => setOpenAndReset(false);

  const folders = scannedFolders(list);
  const currentDir = snapshot?.rootDir;
  const current = currentDir ? folders.find((f) => f.dir === currentDir) : undefined;
  const q = query.trim().toLowerCase();
  const asPath = looksLikePath(query) ? expandHome(query, folders.map((f) => f.dir)) : undefined;
  const recent = folders.filter((f) => f.dir !== currentDir && (!q || asPath || f.dir.toLowerCase().includes(q)));

  // everything ↑ / ↓ / Enter reach, in order
  const items: Item[] = [
    ...(asPath ? [{ key: "path", run: () => onScanPath(asPath) }] : []),
    // a recent project: what was last read of it at once, refreshed behind it
    ...recent.map((f) => ({ key: f.dir, run: () => void openView(f.dir, { kind: "worktree" }) })),
    { key: "browse", run: onBrowse },
    { key: "manage", run: onManage },
  ];
  const activeKey = items[Math.min(active, items.length - 1)]?.key;
  const run = (key: string) => {
    const item = items.find((i) => i.key === key);
    close();
    item?.run();
  };
  const hover = (key: string) => setActive(Math.max(0, items.findIndex((i) => i.key === key)));

  const name = currentDir ? projectName(currentDir) : undefined;
  const trigger = (
    <Flex
      as="button"
      align="center"
      gap="2"
      h="30px"
      maxW="320px"
      minW="0"
      flexShrink={1}
      pl="10px"
      pr="6px"
      rounded="l2"
      borderWidth="1px"
      borderColor="border.emphasized"
      bg="bg.subtle"
      cursor="pointer"
      fontSize={textPx(12.5)}
      _hover={{ bg: "bg.muted" }}
      aria-haspopup="dialog"
      aria-label={currentDir ? `Folder: ${currentDir}. Switch folder (${MOD}O)` : `Open a folder (${MOD}O)`}
      title={currentDir}
    >
      <Box color="fg.subtle" display="inline-flex" flexShrink={0}>
        <IconFolder size={15} />
      </Box>
      {name ? (
        <>
          <Text as="span" fontWeight="semibold" truncate minW="0">
            {name}
          </Text>
        </>
      ) : (
        <Text as="span" flex="1" minW="0" truncate textAlign="start" color="fg.subtle">
          Open a folder to explore…
        </Text>
      )}
      <Kbd size="sm" flexShrink={0}>
        {MOD}O
      </Kbd>
    </Flex>
  );

  return (
    <Popover open={open} onOpenChange={setOpenAndReset} trigger={trigger} label="Switch folder" placement="bottom" width="520px" initialFocusEl={inputRef}>
      <Flex align="center" gap="2" px="3" h="44px" flexShrink={0} borderBottomWidth="1px" borderColor="border" color="fg.subtle">
        <IconSearch size={15} />
        <chakra.input
          ref={inputRef}
          flex="1"
          minW="0"
          bg="transparent"
          outline="none"
          color="fg"
          fontSize={textPx(13)}
          placeholder={folders.length ? "Search recent folders or paste a path…" : "Paste a folder path…"}
          aria-label="Search recent folders or paste a path"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (Math.min(a, items.length - 1) + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
            } else if (e.key === "Enter" && activeKey) {
              e.preventDefault();
              run(activeKey);
            }
          }}
        />
      </Flex>
      <Box overflowY="auto" maxH="min(60vh, 520px)" fontSize={textPx(12.5)}>
        {asPath && (
          <Section>
            <Row k="path" active={activeKey} onRun={run} onHover={hover} icon={<IconRescan size={14} />} name={`Open ${projectName(asPath)}`} path={asPath} meta={<Kbd size="sm">Enter</Kbd>} />
          </Section>
        )}
        {currentDir && !asPath && !q && (
          <Section label="Current">
            <Flex align="center" gap="2.5" px="2" py="1.5" rounded="l2" bg="selection.rowBg">
              <FolderTile current />
              <FolderText name={projectName(currentDir)} path={shortPath(currentDir)} framework={current?.framework ?? snapshot?.framework} />
              <Button
                size="xs"
                variant="outline"
                rounded="l2"
                bg="bg.panel"
                flexShrink={0}
                onClick={() => {
                  close();
                  // the view on screen, read again in the background: a comparison compared again
                  if (snapshot?.diff) void read(currentDir, { diff: diffRequestOf(snapshot.diff) }, true);
                  else void read(currentDir, { latest: snapshot?.commit?.ref }, true);
                }}
              >
                <IconRescan size={13} /> Refresh
              </Button>
            </Flex>
          </Section>
        )}
        {recent.length > 0 && (
          <Section label="Recent" count={q && !asPath ? undefined : recent.length}>
            {recent.map((f) => (
              <Row
                key={f.dir}
                k={f.dir}
                active={activeKey}
                onRun={run}
                onHover={hover}
                icon={<IconFolder size={14} />}
                name={projectName(f.dir)}
                path={shortPath(f.dir)}
                framework={f.framework}
              />
            ))}
          </Section>
        )}
        {q && !asPath && recent.length === 0 && (
          <Text px="4" py="3" color="fg.subtle">
            No recent folder matches “{query.trim()}”. Paste a full path to open another.
          </Text>
        )}
        <Section>
          <Row k="browse" active={activeKey} onRun={run} onHover={hover} icon={<IconFolderOpen size={14} />} name="Browse for a folder…" />
          <Row k="manage" active={activeKey} onRun={run} onHover={hover} icon={<IconSettings size={14} />} name="Manage projects…" hint="remove the ones you no longer need" />
        </Section>
      </Box>
    </Popover>
  );
}

function Section({ label, count, children }: { label?: string; count?: number; children: ReactNode }) {
  return (
    <Box p="1.5" _notFirst={{ borderTopWidth: "1px", borderColor: "border" }}>
      {label && (
        <Flex justify="space-between" px="2" pt="1.5" pb="1">
          <Text textStyle="panelLabel" color="fg.subtle">
            {label}
          </Text>
          {count !== undefined && (
            <Text fontSize={textPx(11)} color="fg.subtle">
              {count}
            </Text>
          )}
        </Flex>
      )}
      {children}
    </Box>
  );
}

function FolderTile({ current, children }: { current?: boolean; children?: ReactNode }) {
  return (
    <Flex
      align="center"
      justify="center"
      w="28px"
      h="28px"
      flexShrink={0}
      rounded="l2"
      borderWidth={current ? 0 : "1px"}
      borderColor="border"
      bg={current ? "selection.solid" : "bg.subtle"}
      color={current ? "accent.contrast" : "fg.subtle"}
    >
      {children ?? <IconFolderOpen size={15} />}
    </Flex>
  );
}

function FolderText({ name, path, framework, hint }: { name: string; path?: string; framework?: Framework; hint?: string }) {
  return (
    <Box flex="1" minW="0" textAlign="start">
      <Flex align="center" gap="1.5" fontWeight="semibold" whiteSpace="nowrap">
        <Text as="span" truncate>
          {name}
        </Text>
        {framework && (
          <Text as="span" fontSize={textPx(10.5)} fontWeight="medium" color="fg.muted" px="1" rounded="sm" borderWidth="1px" borderColor="border.emphasized" flexShrink={0}>
            {FRAMEWORK[framework]}
          </Text>
        )}
        {hint && (
          <Text as="span" fontWeight="normal" color="fg.subtle" truncate>
            {hint}
          </Text>
        )}
      </Flex>
      {path && (
        <Text fontFamily="mono" fontSize={textPx(11)} color="fg.subtle" truncate title={path}>
          {path}
        </Text>
      )}
    </Box>
  );
}

function Row(props: { k: string; active?: string; onRun: (k: string) => void; onHover: (k: string) => void; icon: ReactNode; name: string; path?: string; framework?: Framework; hint?: string; meta?: ReactNode }) {
  const { k, active, onRun, onHover, icon, meta } = props;
  return (
    <Flex
      as="button"
      w="full"
      align="center"
      gap="2.5"
      px="2"
      py="1.5"
      rounded="l2"
      cursor="pointer"
      bg={k === active ? "bg.muted" : undefined}
      tabIndex={-1}
      onMouseMove={() => k !== active && onHover(k)}
      onClick={() => onRun(k)}
    >
      <FolderTile>{icon}</FolderTile>
      <FolderText name={props.name} path={props.path} framework={props.framework} hint={props.hint} />
      {meta && (
        <Text as="span" fontSize={textPx(11.5)} color="fg.subtle" textAlign="end" whiteSpace="nowrap" flexShrink={0} css={{ fontVariantNumeric: "tabular-nums" }}>
          {meta}
        </Text>
      )}
    </Flex>
  );
}
