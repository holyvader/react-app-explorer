import { Button, Flex, SearchSelect, Select, type SelectOption, Spinner, Stack, Switch, SwitchField, Text } from "@rae/design-system";
import { IconBranch } from "@rae/design-system/icons";
import type { GitOverview, GitRequest, GitRequestList, GitTools, GitToolStatus, RequestSource } from "@rae/schema";
import { useEffect, useMemo, useState } from "react";
import { fetchGit, fetchGitRequests, fetchGitTools, type ScanSettings } from "../lib/api.ts";
import { branchOptions, branchPrefix } from "../lib/branches.ts";
import { readSetting, writeSetting } from "../lib/settings.ts";
import { plural } from "../lib/text.ts";

/** What "Compare" sends: undefined while off (a plain scan). */
export type CompareChoice = ScanSettings["diff"];

export interface CompareOptionsProps {
  /** The folder (or entry file) to scan; its git repo is looked up as it changes. */
  path: string;
  onChange: (diff: CompareChoice) => void;
}

const HEAD = "head:HEAD";
const WORKTREE = "worktree";
const SOURCE_KEY = (root: string) => `rae.requestSource:${root}`;
const TOOL_NAME = { gh: "GitHub CLI", glab: "GitLab CLI", git: "git" } as const;

type Keyed<T> = { key: string } & T;

/** What a tool can do here, in a few words: "logged in", "not logged in", "not installed". */
const toolState = (t: GitToolStatus | undefined) => (!t ? "checking…" : !t.installed ? "not installed" : t.authed ? `logged in${t.version ? `, ${t.version}` : ""}` : "not logged in");

/**
 * Diff mode in the scan dialog: when the folder is in a git repo, compare the checkout (with or
 * without uncommitted changes), a branch, or a pull / merge request with a base branch. Requests are
 * listed on demand (a network call) from a source the user picks, remembered per repo: Auto (the
 * host's CLI — gh / glab — when installed and logged in, else git), git's refs (open and closed, no
 * titles), or a CLI explicitly (open ones, with title, author, target branch and link).
 */
export function CompareOptions({ path, onChange }: CompareOptionsProps) {
  const target = path.trim();
  // answers are kept with the folder they're for: another folder's are simply not used (no resets)
  const [loaded, setLoaded] = useState<Keyed<{ git: GitOverview }>>();
  const git = loaded?.key === target ? loaded.git : undefined;
  const repo = git?.repo;
  const [toolsFor, setToolsFor] = useState<Keyed<{ tools?: GitTools; checking?: boolean }>>();
  const tools = repo && toolsFor?.key === repo.root ? toolsFor : undefined;
  const [requestsFor, setRequestsFor] = useState<Keyed<{ list?: GitRequestList; loading?: boolean; error?: string }>>();
  const requests = repo && requestsFor?.key === repo.root ? requestsFor : undefined;
  // the source per repo: what the user picked (remembered), Auto otherwise
  const [picked, setPicked] = useState<Record<string, RequestSource>>({});
  const source: RequestSource = repo ? (picked[repo.root] ?? readSetting<RequestSource>(SOURCE_KEY(repo.root), "auto")) : "auto";

  const [on, setOn] = useState(false);
  const [base, setBase] = useState("");
  const [head, setHead] = useState(HEAD);
  const [fromMergeBase, setFromMergeBase] = useState(true);

  // the repo of the chosen folder (debounced while typing)
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetchGit(target)
        .then((g) => {
          if (cancelled) return;
          setLoaded({ key: target, git: g });
          const names = g.branches.map((b) => b.name);
          const preferred = [g.repo?.defaultBranch, g.repo?.defaultBranch && `origin/${g.repo.defaultBranch}`, "main", "master"].find((n) => n && names.includes(n));
          setBase(preferred ?? names[0] ?? "");
          setHead(HEAD);
        })
        .catch(() => !cancelled && setLoaded({ key: target, git: { repo: null, branches: [] } }));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [target]);

  // the CLIs, checked once Compare is on (`auth status` may ask the host)
  const root = repo?.root;
  useEffect(() => {
    if (!on || !root) return;
    let cancelled = false;
    fetchGitTools(root)
      .then((t) => !cancelled && setToolsFor({ key: root, tools: t }))
      .catch(() => !cancelled && setToolsFor({ key: root }));
    return () => {
      cancelled = true;
    };
  }, [on, root]);

  const chosenRequest = head.startsWith("req:") ? requests?.list?.requests.find((r) => r.ref === head.slice(4)) : undefined;
  const choice = useMemo<CompareChoice>(() => {
    if (!on || !repo || !base) return undefined;
    const against = fromMergeBase ? "merge-base" : "base";
    if (head.startsWith("req:")) {
      const r = chosenRequest;
      return { base, request: head.slice(4), against, ...(r?.title || r?.url ? { requestInfo: { title: r.title, author: r.author, url: r.url } } : {}) };
    }
    if (head === WORKTREE) return { base, worktree: true, against };
    return { base, head: head.slice(head.indexOf(":") + 1), against };
  }, [on, repo, base, head, fromMergeBase, chosenRequest]);
  useEffect(() => onChange(choice), [choice, onChange]);

  // no repo: nothing to compare; no git at all: say what to install
  if (!repo)
    return git?.error ? (
      <Text fontSize="xs" color="fg.muted" px="1">
        Compare (diff mode) needs git: {git.error}
      </Text>
    ) : null;

  const branchNames = new Set(git!.branches.map((b) => b.name));
  const baseOptions = branchOptions(git!.branches, (name) => name);
  const listed = requests?.list;
  const viaCli = !!listed && listed.source !== "git";
  // requests keep their order (newest first) within each group; groups in order of first appearance
  const requestOptions = (list: GitRequest[], groupOf: (r: GitRequest) => string): SelectOption[] => {
    const groups = new Map<string, SelectOption[]>();
    for (const r of list) {
      const g = groupOf(r);
      groups.set(g, [...(groups.get(g) ?? []), { value: `req:${r.ref}`, label: requestLabel(r), group: g }]);
    }
    return [...groups.values()].flat();
  };
  const requestLabel = (r: GitRequest) => {
    const num = `${r.provider === "github" ? "#" : "!"}${r.number}`;
    if (!r.title) return `${num} — ${r.sha.slice(0, 7)}`;
    return `${num} ${r.title.slice(0, 70)}${r.author ? ` — ${r.author}` : ""}${r.draft ? " (draft)" : ""}${r.baseBranch ? ` → ${r.baseBranch}` : ""}`;
  };
  const headOptions: SelectOption[] = [
    { value: HEAD, label: `The checkout${repo.branch ? ` (${repo.branch})` : ""} — ${repo.head.slice(0, 7)}`, group: "Checked out" },
    { value: WORKTREE, label: `The checkout with uncommitted changes${repo.dirty ? "" : " (none now)"}`, group: "Checked out" },
    // requests first once listed (what "List" was pressed for), grouped by their branch's prefix
    ...requestOptions(listed?.requests ?? [], (r) => {
      const what = viaCli ? `Open ${r.provider === "github" ? "pull" : "merge"} requests` : `${r.provider === "github" ? "Pull" : "Merge"} requests (git, open and closed)`;
      const prefix = r.headBranch ? branchPrefix(r.headBranch) : undefined;
      return prefix ? `${what} · ${prefix}` : what;
    }),
    ...branchOptions(git!.branches, (name) => `branch:${name}`),
  ];

  // Auto's pick, in words: "GitHub CLI", or "git (no CLI logged in)"
  const auto = tools?.tools?.auto;
  const sourceOptions: SelectOption[] = [
    { value: "auto", label: `Auto — ${!tools?.tools ? "checking…" : auto === "git" ? "git (no CLI logged in)" : TOOL_NAME[auto!]}` },
    { value: "git", label: "git — refs: open and closed, no titles" },
    { value: "gh", label: `GitHub CLI (gh) — ${toolState(tools?.tools?.gh)}` },
    { value: "glab", label: `GitLab CLI (glab) — ${toolState(tools?.tools?.glab)}` },
  ];
  const setSource = (s: string) => {
    writeSetting(SOURCE_KEY(repo.root), s);
    setPicked((p) => ({ ...p, [repo.root]: s as RequestSource }));
  };

  // a request: compared with the branch it merges into, when that branch is here
  const pickRequest = (r: GitRequest) => {
    setHead(`req:${r.ref}`);
    const into = r.baseBranch && [r.baseBranch, `origin/${r.baseBranch}`].find((n) => branchNames.has(n));
    if (into) setBase(into);
  };
  const loadRequests = () => {
    const at = repo.root;
    setRequestsFor({ key: at, loading: true });
    fetchGitRequests(target, source)
      .then((list) => {
        setRequestsFor({ key: at, list, error: list.error ?? (list.requests.length ? undefined : `No ${list.source === "git" ? "" : "open "}pull / merge requests on origin`) });
        if (list.requests[0]) pickRequest(list.requests[0]); // the newest one, ready to compare
      })
      .catch((e: Error) => setRequestsFor({ key: at, error: e.message }));
  };
  const recheck = () => {
    setToolsFor({ key: repo.root, checking: true });
    fetchGitTools(repo.root, true)
      .then((t) => setToolsFor({ key: repo.root, tools: t }))
      .catch(() => setToolsFor({ key: repo.root }));
  };
  const explicitTool = source === "gh" || source === "glab" ? tools?.tools?.[source] : undefined;

  return (
    <Stack gap="2.5" borderWidth="1px" borderColor={on ? "diff.changed.solid" : "border"} rounded="md" px="3" py="2.5">
      <SwitchField
        size="sm"
        ariaLabel="Compare (diff mode)"
        label={
          <Flex align="center" gap="1.5" fontSize="sm">
            <IconBranch size={14} /> Compare (diff mode)
          </Flex>
        }
        hint={`Scan two commits of ${repo.root.split("/").pop()} and show what changed: a branch or pull / merge request against its base.`}
        checked={on}
        onCheckedChange={setOn}
      />
      {on && (
        <Stack gap="2" fontSize="sm">
          <Flex align="center" gap="2">
            <Text w="72px" color="fg.muted" flexShrink={0}>
              Base
            </Text>
            <SearchSelect label="Base branch" value={base} onValueChange={setBase} options={baseOptions} width="full" size="sm" placeholder="Search branches…" emptyText="No branch matches" />
          </Flex>
          <Flex align="center" gap="2">
            <Text w="72px" color="fg.muted" flexShrink={0}>
              Compare
            </Text>
            <SearchSelect
              label="What to compare"
              value={head}
              onValueChange={(v) => {
                const r = v.startsWith("req:") ? listed?.requests.find((x) => x.ref === v.slice(4)) : undefined;
                if (r) pickRequest(r);
                else setHead(v);
              }}
              options={headOptions}
              width="full"
              size="sm"
              placeholder="Search branches, PRs / MRs…"
              emptyText="No branch or request matches"
            />
          </Flex>
          <Flex align="center" gap="2">
            <Text w="72px" color="fg.muted" flexShrink={0}>
              PRs / MRs
            </Text>
            <Select label="List pull / merge requests from" value={source} onValueChange={setSource} options={sourceOptions} width="full" size="sm" />
            <Button
              size="xs"
              variant="outline"
              rounded="l2"
              flexShrink={0}
              onClick={loadRequests}
              disabled={requests?.loading || !repo.remote}
              title={repo.remote ? `List pull / merge requests on ${repo.remote.url}` : "No origin remote"}
            >
              {requests?.loading ? <Spinner size="xs" /> : null} List
            </Button>
          </Flex>
          {(requests?.error || listed || tools?.checking) && (
            <Text fontSize="xs" color="fg.muted" pl="80px">
              {requests?.error ??
                (listed
                  ? `${listed.requests.length} ${viaCli ? "open " : ""}${plural(listed.requests.length, "request", { word: true })} via ${TOOL_NAME[listed.source]}${listed.fallback ? ` — ${listed.fallback}` : ""}`
                  : "Checking the CLIs…")}
            </Text>
          )}
          {explicitTool && !explicitTool.authed && (
            <Flex align="center" gap="2" pl="80px">
              <Text fontSize="xs" color="diff.changed.fg">
                {explicitTool.installed ? explicitTool.error : `${source} isn't installed`}
              </Text>
              <Button size="2xs" variant="ghost" onClick={recheck}>
                Check again
              </Button>
            </Flex>
          )}
          {chosenRequest?.headBranch && (
            <Text fontSize="xs" color="fg.muted" pl="80px" truncate title={chosenRequest.title}>
              {chosenRequest.headBranch} → {chosenRequest.baseBranch ?? "?"}
              {chosenRequest.updatedAt ? ` · updated ${new Date(chosenRequest.updatedAt).toLocaleDateString()}` : ""}
            </Text>
          )}
          <Flex align="center" gap="2" pl="80px">
            <Switch size="xs" checked={fromMergeBase} onCheckedChange={setFromMergeBase}>
              <Text fontSize="xs">From the merge-base (what the PR / MR shows; later commits on the base left out)</Text>
            </Switch>
          </Flex>
          {head === HEAD && repo.dirty && (
            <Text fontSize="xs" color="diff.changed.fg" pl="80px">
              The checkout has uncommitted changes: they aren't in a diff of its commit. Pick “with uncommitted changes” to include them.
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
