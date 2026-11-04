import { Box, Button, Flex, Select, type SelectOption, Spinner, Stack, Switch, Text } from "@rae/design-system";
import { IconBranch } from "@rae/design-system/icons";
import type { GitOverview, GitRequest } from "@rae/schema";
import { useEffect, useMemo, useState } from "react";
import { fetchGit, fetchGitRequests, type ScanSettings } from "../lib/api.ts";

/** What "Compare" sends: undefined while off (a plain scan). */
export type CompareChoice = ScanSettings["diff"];

export interface CompareOptionsProps {
  /** The folder (or entry file) to scan; its git repo is looked up as it changes. */
  path: string;
  onChange: (diff: CompareChoice) => void;
}

const HEAD = "head:HEAD";

type RequestsState = { path: string; list?: GitRequest[]; loading?: boolean; error?: string };

/**
 * Diff mode in the scan dialog: when the folder is in a git repo, compare the checkout, a branch, a
 * commit or an open pull / merge request with a base branch. Branches come from `git for-each-ref`;
 * requests from the refs GitHub / GitLab publish (`git ls-remote`, loaded on demand: it's a network call).
 */
export function CompareOptions({ path, onChange }: CompareOptionsProps) {
  // what was loaded, for which folder: another folder's answer is ignored (no reset needed)
  const [loaded, setLoaded] = useState<{ path: string; git: GitOverview }>();
  const target = path.trim();
  const git = loaded?.path === target ? loaded.git : undefined;
  const [on, setOn] = useState(false);
  const [base, setBase] = useState("");
  const [head, setHead] = useState(HEAD);
  const [fromMergeBase, setFromMergeBase] = useState(true);
  const [requestsFor, setRequestsFor] = useState<RequestsState>();
  const requestsState: Partial<RequestsState> = requestsFor?.path === target ? requestsFor : {};
  const requests = requestsState.list;

  // the repo of the chosen folder (debounced while typing)
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetchGit(target)
        .then((g) => {
          if (cancelled) return;
          setLoaded({ path: target, git: g });
          const names = g.branches.map((b) => b.name);
          const preferred = [g.repo?.defaultBranch, g.repo?.defaultBranch && `origin/${g.repo.defaultBranch}`, "main", "master"].find((n) => n && names.includes(n));
          setBase(preferred ?? names[0] ?? "");
          setHead(HEAD);
        })
        .catch(() => !cancelled && setLoaded({ path: target, git: { repo: null, branches: [] } }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [target]);

  const repo = git?.repo;
  const choice = useMemo<CompareChoice>(() => {
    if (!on || !repo || !base) return undefined;
    const against = fromMergeBase ? "merge-base" : "base";
    if (head.startsWith("req:")) return { base, request: head.slice(4), against };
    return { base, head: head.slice(head.indexOf(":") + 1), against };
  }, [on, repo, base, head, fromMergeBase]);
  useEffect(() => onChange(choice), [choice, onChange]);

  if (!repo) return null;

  const branchOptions: SelectOption[] = git!.branches.map((b) => ({ value: b.name, label: `${b.name} — ${b.subject.slice(0, 60)}`, group: b.remote ? "Remote branches" : "Branches" }));
  const headOptions: SelectOption[] = [
    { value: HEAD, label: `The checkout${repo.branch ? ` (${repo.branch})` : ""} — ${repo.head.slice(0, 7)}`, group: "Checked out" },
    ...git!.branches.map((b) => ({ value: `branch:${b.name}`, label: `${b.name} — ${b.subject.slice(0, 60)}`, group: b.remote ? "Remote branches" : "Branches" })),
    ...(requests ?? []).map((r) => ({
      value: `req:${r.ref}`,
      label: `${r.provider === "github" ? "#" : "!"}${r.number} — ${r.sha.slice(0, 7)}`,
      group: r.provider === "github" ? "Pull requests" : "Merge requests",
    })),
  ];
  const loadRequests = () => {
    const at = target;
    setRequestsFor({ path: at, loading: true });
    fetchGitRequests(at)
      .then((r) => setRequestsFor({ path: at, list: r.requests, error: r.error ?? (r.requests.length ? undefined : "No open pull / merge requests on origin") }))
      .catch((e: Error) => setRequestsFor({ path: at, error: e.message }));
  };

  return (
    <Stack gap="2.5" borderWidth="1px" borderColor={on ? "diff.changed.solid" : "border"} rounded="md" px="3" py="2.5">
      <Flex align="center" gap="3">
        <Box flex="1" minW="0">
          <Flex align="center" gap="1.5" fontSize="sm">
            <IconBranch size={14} /> Compare (diff mode)
          </Flex>
          <Text fontSize="xs" color="fg.muted">
            Scan two commits of {repo.root.split("/").pop()} and show what changed: a branch or pull / merge request against its base.
          </Text>
        </Box>
        <Switch size="sm" label="Compare (diff mode)" checked={on} onCheckedChange={setOn} />
      </Flex>
      {on && (
        <Stack gap="2" fontSize="sm">
          <Flex align="center" gap="2">
            <Text w="72px" color="fg.muted" flexShrink={0}>
              Base
            </Text>
            <Select label="Base branch" value={base} onValueChange={setBase} options={branchOptions} width="full" size="sm" />
          </Flex>
          <Flex align="center" gap="2">
            <Text w="72px" color="fg.muted" flexShrink={0}>
              Compare
            </Text>
            <Select label="What to compare" value={head} onValueChange={setHead} options={headOptions} width="full" size="sm" />
            <Button size="xs" variant="outline" rounded="l2" flexShrink={0} onClick={loadRequests} disabled={requestsState.loading || !repo.remote} title={repo.remote ? `List open pull / merge requests on ${repo.remote.url}` : "No origin remote"}>
              {requestsState.loading ? <Spinner size="xs" /> : null} PRs / MRs
            </Button>
          </Flex>
          {requestsState.error && (
            <Text fontSize="xs" color="fg.muted" pl="80px">
              {requestsState.error}
            </Text>
          )}
          <Flex align="center" gap="2" pl="80px">
            <Switch size="xs" checked={fromMergeBase} onCheckedChange={setFromMergeBase}>
              <Text fontSize="xs">From the merge-base (what the PR / MR shows; later commits on the base left out)</Text>
            </Switch>
          </Flex>
          {head === HEAD && repo.dirty && (
            <Text fontSize="xs" color="diff.changed.fg" pl="80px">
              The checkout has uncommitted changes: a diff compares commits, so they aren't in it.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
