import { ActionIconButton, Box, Button, Flex, SegmentedControl, Text, textPx, Tooltip } from "@rae/design-system";
import { IconBranch, IconOpen, IconRouteChain } from "@rae/design-system/icons";
import type { SnapshotDiff } from "@rae/schema";
import { useMemo } from "react";
import { sideLabel } from "../lib/diff.ts";
import { openRequestPage } from "../lib/editor.ts";
import { type DiffMode, diffModeOf, useExplorer } from "../store.ts";

const DIFF_MODES: { value: DiffMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "overlay", label: "Overlay" },
  { value: "code", label: "Overlay + code" },
];

/**
 * The Git bar, under the app bar while the open snapshot is a diff: what it compares, how many
 * elements were added / changed / removed, the diff view and What it affects. The app bar itself
 * stays the same with or without a diff.
 */
export function DiffBar({ diff }: { diff: SnapshotDiff }) {
  const mode = useExplorer(diffModeOf);
  const counts = useMemo(() => {
    let added = 0;
    let changed = 0;
    for (const kind of Object.values(diff.nodes)) {
      if (kind === "added") added++;
      else if (kind === "changed") changed++;
    }
    return { added, changed, removed: Object.keys(diff.removed).length };
  }, [diff]);

  return (
    <Flex
      role="region"
      aria-label="Comparison"
      align="center"
      gap="3"
      pl="3.5"
      pr="3"
      h="38px"
      flexShrink={0}
      minW="0"
      bg="diff.changed.subtle"
      borderBottomWidth="1px"
      borderColor="border"
      color="diff.changed.fg"
    >
      <DiffRefs diff={diff} />
      <Flex align="center" gap="2.5" flexShrink={0} fontFamily="mono" fontSize={textPx(12)}>
        <Count n={counts.added} sign="+" what="added" color="diff.added.fg" />
        <Count n={counts.changed} sign="~" what="changed" color="diff.changed.fg" />
        <Count n={counts.removed} sign="−" what="removed" color="diff.removed.fg" />
      </Flex>
      <Box flex="1" />
      <Tooltip content="Overlay: what changed in colour, removed elements as ghosts. Overlay + code: also the changed lines in the tooltip of a changed element.">
        <Text as="span" fontSize={textPx(12)} flexShrink={0}>
          Show
        </Text>
      </Tooltip>
      <SegmentedControl label="Diff view" tone="diff.changed" value={mode} options={DIFF_MODES} onValueChange={(v) => useExplorer.getState().setDiffMode(v as DiffMode)} />
      <Button
        size="xs"
        h="28px"
        px="10px"
        variant="outline"
        rounded="l2"
        flexShrink={0}
        borderColor="diff.changed.solid"
        color="diff.changed.fg"
        _hover={{ bg: "blackAlpha.100" }}
        fontSize={textPx(12)}
        gap="6px"
        onClick={() => useExplorer.getState().setImpactOpen(true)}
      >
        <IconRouteChain size={13} /> What it affects
      </Button>
    </Flex>
  );
}

function Count({ n, sign, what, color }: { n: number; sign: string; what: string; color: string }) {
  return (
    <Text as="span" color={color} whiteSpace="nowrap" opacity={n ? 1 : 0.6}>
      {sign}
      {n} {what}
    </Text>
  );
}

/** What a diff compares: `main ← #12 Fix footer` (a PR / MR, with a link to its page), `main ← feature 1a2b3c4`. */
function DiffRefs({ diff }: { diff: SnapshotDiff }) {
  const req = diff.head.request;
  const head = req ? `${req.provider === "github" ? "#" : "!"}${req.number}${req.title ? ` ${req.title}` : ""}` : sideLabel(diff.head.ref, diff.head.sha, diff.head.worktree);
  const tip = [
    req?.title ? `${req.provider === "github" ? "Pull" : "Merge"} request ${req.provider === "github" ? "#" : "!"}${req.number}: ${req.title}${req.author ? ` (${req.author})` : ""}` : undefined,
    `Comparing ${diff.head.ref} (${diff.head.sha.slice(0, 7)}${diff.head.subject ? `: ${diff.head.subject}` : ""})`,
    `with ${diff.against === "merge-base" ? `its merge-base with ${diff.base.ref}` : diff.base.ref} (${diff.compared.slice(0, 7)})`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Flex align="center" gap="0.5" flexShrink={1} minW="0">
      <Tooltip content={tip}>
        <Flex align="center" gap="1.5" minW="0" fontFamily="mono" fontSize={textPx(12)}>
          <IconBranch size={13} style={{ flexShrink: 0 }} />
          <Text as="span" truncate>
            <Text as="span" opacity={0.8}>
              {sideLabel(diff.base.ref, diff.compared).split(" ")[0]}
            </Text>{" "}
            ← <Text as="span" fontWeight="medium">{head}</Text>
          </Text>
        </Flex>
      </Tooltip>
      {req?.url && (
        <ActionIconButton
          label={`Open ${req.provider === "github" ? "the pull request on GitHub" : "the merge request on GitLab"}`}
          icon={<IconOpen />}
          size="2xs"
          color="diff.changed.fg"
          onClick={() => void openRequestPage(req.url!).catch((e: Error) => useExplorer.getState().notify(e.message))}
        />
      )}
    </Flex>
  );
}
