import { Alert, Badge, Box, Button, Checkbox, Flex, HStack, Modal, Stack, Text } from "@rae/design-system";
import { useState } from "react";
import type { SnapshotList } from "../lib/api.ts";
import { scannedFolders } from "../lib/folders.ts";
import { projectName, shortPath } from "../lib/paths.ts";
import { removeProjects, viewKey } from "../lib/projects.ts";
import { plural } from "../lib/text.ts";

export interface ProjectsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list?: SnapshotList;
  /** The open project's folder. */
  current?: string;
  /** Called with the snapshot files removed, so the app can refresh (and open another project if needed). */
  onDeleted: (removed: string[]) => void;
}

const FRAMEWORK = { "next-app": "Next.js", "next-pages": "Next.js", react: "React" } as const;

/** What a project keeps, in words: "working tree · 2 branches · 1 comparison". */
function keptOf(list: SnapshotList, dir: string): string {
  const keys = new Set(list.snapshots.filter((s) => s.rootDir === dir).map(viewKey));
  const branches = [...keys].filter((k) => k.startsWith("branch:")).length;
  const diffs = [...keys].filter((k) => k.startsWith("diff:")).length;
  return [keys.has("worktree") ? "working tree" : "", branches ? `${branches} ${branches === 1 ? "branch" : "branches"}` : "", diffs ? plural(diffs, "comparison") : ""].filter(Boolean).join(" · ");
}

/**
 * Manage projects: the ones opened so far, with what is kept of each (its working tree, branches,
 * comparisons). Remove the ones no longer needed: what was read of them goes (the project's own
 * folder isn't touched); opening one again reads it anew.
 */
export function ProjectsModal({ open, onOpenChange, list, current, onDeleted }: ProjectsModalProps) {
  const projects = scannedFolders(list);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const close = (o: boolean) => {
    if (busy) return;
    if (!o) {
      setSelected(new Set());
      setConfirming(false);
      setError(undefined);
    }
    onOpenChange(o);
  };
  const toggle = (dir: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(dir);
      else next.delete(dir);
      return next;
    });
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const removed = await removeProjects([...selected]);
      setSelected(new Set());
      setConfirming(false);
      onDeleted(removed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title="Projects"
      size="lg"
      footer={
        confirming ? (
          <HStack w="full">
            <Text fontSize="sm" flex="1">
              Remove {plural(selected.size, "project")}? Their folders aren't touched: opening one again reads it anew.
            </Text>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Keep them
            </Button>
            <Button colorPalette="red" onClick={() => void remove()} loading={busy}>
              Remove
            </Button>
          </HStack>
        ) : (
          <HStack w="full">
            <Box flex="1" />
            <Button variant="outline" onClick={() => close(false)}>
              Close
            </Button>
            <Button colorPalette="red" variant="subtle" disabled={!selected.size} onClick={() => setConfirming(true)}>
              Remove{selected.size ? ` ${selected.size}` : ""}…
            </Button>
          </HStack>
        )
      }
    >
      <Stack gap="3">
        {projects.length === 0 ? (
          <Text fontSize="sm" color="fg.muted" py="6" textAlign="center">
            No projects yet.
          </Text>
        ) : (
          <>
            <Checkbox checked={projects.length > 0 && selected.size === projects.length} onCheckedChange={(on) => setSelected(new Set(on ? projects.map((p) => p.dir) : []))}>
              Select all ({projects.length})
            </Checkbox>
            <Box borderWidth="1px" borderColor="border" rounded="l2" maxH="440px" overflowY="auto">
              {projects.map((p, i) => (
                <Flex key={p.dir} align="center" gap="3" px="3" py="2.5" borderTopWidth={i ? "1px" : 0} borderColor="border.muted" bg={selected.has(p.dir) ? "bg.muted" : undefined}>
                  <Checkbox checked={selected.has(p.dir)} onCheckedChange={(on) => toggle(p.dir, on)} aria-label={`Select ${projectName(p.dir)}`} />
                  <Box flex="1" minW="0">
                    <HStack gap="2">
                      <Text fontSize="sm" fontWeight="semibold" truncate title={p.dir}>
                        {projectName(p.dir)}
                      </Text>
                      {p.framework && (
                        <Badge size="xs" variant="outline">
                          {FRAMEWORK[p.framework]}
                        </Badge>
                      )}
                      {p.dir === current && (
                        <Badge size="xs" colorPalette="accent" variant="subtle">
                          Open
                        </Badge>
                      )}
                    </HStack>
                    <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate title={p.dir}>
                      {shortPath(p.dir)}
                    </Text>
                  </Box>
                  <Text fontSize="xs" color="fg.muted" textAlign="right" flexShrink={0}>
                    {list ? keptOf(list, p.dir) : ""}
                  </Text>
                </Flex>
              ))}
            </Box>
          </>
        )}
        {error && (
          <Alert status="error" title="Couldn't remove">
            {error}
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
