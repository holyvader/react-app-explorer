import { Alert, Badge, Box, Button, Checkbox, Flex, HStack, Modal, Stack, Text } from "@rae/design-system";
import { useState } from "react";
import { deleteSnapshots, type SnapshotList } from "../lib/api.ts";
import { projectName, shortPath } from "../lib/paths.ts";
import { plural } from "../lib/text.ts";

export interface SnapshotsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list?: SnapshotList;
  /** The loaded snapshot's file. */
  current?: string;
  /** Called with the files removed, so the app can refresh (and pick another snapshot if needed). */
  onDeleted: (removed: string[]) => void;
}

type Entry = SnapshotList["snapshots"][number];

/** Snapshots by scanned folder, in the list's order (newest first). */
function groupsOf(list: Entry[]): [string | undefined, Entry[]][] {
  const groups = new Map<string | undefined, Entry[]>();
  for (const s of list) groups.set(s.rootDir, [...(groups.get(s.rootDir) ?? []), s]);
  return [...groups];
}

/** Lists the snapshots in the snapshots folder; select some and delete them (after a confirmation). */
export function SnapshotsModal({ open, onOpenChange, list, current, onDeleted }: SnapshotsModalProps) {
  const snapshots = list?.snapshots ?? [];
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
  const toggle = (file: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(file);
      else next.delete(file);
      return next;
    });
  const allSelected = snapshots.length > 0 && selected.size === snapshots.length;
  // everything but each project's newest snapshot (the list is newest first)
  const olderOnes = () => {
    const seen = new Set<string>();
    return snapshots.filter((s) => {
      const key = s.rootDir ?? s.file;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  };

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const removed = await deleteSnapshots([...selected]);
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
      title="Snapshots"
      size="lg"
      footer={
        confirming ? (
          <HStack w="full">
            <Text fontSize="sm" flex="1">
              Delete {plural(selected.size, "snapshot")}? This can't be undone.
            </Text>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Keep them
            </Button>
            <Button colorPalette="red" onClick={() => void remove()} loading={busy}>
              Delete
            </Button>
          </HStack>
        ) : (
          <HStack w="full">
            <Box flex="1" />
            <Button variant="outline" onClick={() => close(false)}>
              Close
            </Button>
            <Button colorPalette="red" variant="subtle" disabled={!selected.size} onClick={() => setConfirming(true)}>
              Delete{selected.size ? ` ${selected.size}` : ""}…
            </Button>
          </HStack>
        )
      }
    >
      <Stack gap="3">
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" truncate title={list?.dir}>
          {list?.dir}
        </Text>
        {snapshots.length === 0 ? (
          <Text fontSize="sm" color="fg.muted" py="6" textAlign="center">
            No snapshots yet.
          </Text>
        ) : (
          <>
            <Flex align="center" gap="3">
              <Checkbox checked={allSelected} onCheckedChange={(on) => setSelected(new Set(on ? snapshots.map((s) => s.file) : []))}>
                Select all ({snapshots.length})
              </Checkbox>
              <Box flex="1" />
              <Button size="2xs" variant="ghost" onClick={() => setSelected(new Set(olderOnes().map((s) => s.file)))} disabled={!olderOnes().length}>
                Select all but the newest per project
              </Button>
            </Flex>
            <Box borderWidth="1px" borderColor="border" rounded="l2" maxH="420px" overflowY="auto">
              {/* grouped by the scanned folder, groups in order of their newest snapshot */}
              {groupsOf(snapshots).map(([dir, items], g) => {
                const all = items.every((s) => selected.has(s.file));
                return (
                  <Box key={dir ?? "?"} borderTopWidth={g ? "1px" : 0} borderColor="border">
                    <Flex align="center" gap="3" px="3" py="2" bg="bg.subtle" position="sticky" top="0" zIndex="1">
                      <Checkbox checked={all} onCheckedChange={(on) => items.forEach((s) => toggle(s.file, on))} aria-label={`Select all of ${dir ?? "unknown project"}`} />
                      <Box flex="1" minW="0">
                        <Text fontSize="sm" fontWeight="semibold" truncate title={dir}>
                          {dir ? projectName(dir) : "Unknown project"}
                        </Text>
                        {dir && (
                          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono" truncate title={dir}>
                            {shortPath(dir)}
                          </Text>
                        )}
                      </Box>
                      <Text fontSize="xs" color="fg.muted">
                        {items.length}
                      </Text>
                    </Flex>
                    {items.map((s) => (
                      <Flex
                        key={s.file}
                        align="center"
                        gap="3"
                        px="3"
                        pl="8"
                        py="2"
                        borderTopWidth="1px"
                        borderColor="border.muted"
                        bg={selected.has(s.file) ? "bg.muted" : undefined}
                      >
                        <Checkbox checked={selected.has(s.file)} onCheckedChange={(on) => toggle(s.file, on)} />
                        <Box flex="1" minW="0">
                          <HStack gap="2">
                            <Text fontSize="sm" truncate>
                              {new Date(s.createdAt).toLocaleString()}
                            </Text>
                            {s.file === current && (
                              <Badge size="xs" colorPalette="accent" variant="subtle">
                                Loaded
                              </Badge>
                            )}
                          </HStack>
                          <Text fontSize="xs" color="fg.muted" truncate>
                            {[s.nodeCount !== undefined ? `${s.nodeCount} nodes` : "", s.framework ?? ""].filter(Boolean).join(" · ")}
                          </Text>
                        </Box>
                      </Flex>
                    ))}
                  </Box>
                );
              })}
            </Box>
          </>
        )}
        {error && (
          <Alert status="error" title="Couldn't delete">
            {error}
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
