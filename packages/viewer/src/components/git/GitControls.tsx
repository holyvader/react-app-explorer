import { Box, Button, chakra, Flex, Popover, SearchSelect, Select, Spinner, Switch, Text, textPx } from "@rae/design-system";
import { IconArrowDown, IconBranch, IconChevronDown, IconDiff, IconRescan, IconSearch } from "@rae/design-system/icons";
import type { GitBranch, GitOverview, GitRepo, GitRequest, GitRequestList, RequestSource } from "@rae/schema";
import { useEffect, useMemo, useState } from "react";
import { fetchGit, fetchGitRequests, gitAction, type ScanSettings } from "../../lib/api.ts";
import { branchOptions, groupByPrefix, remoteLabel } from "../../lib/branches.ts";
import { openView, read, type View } from "../../lib/projects.ts";
import { readSetting, writeSetting } from "../../lib/settings.ts";
import { useExplorer } from "../../store.ts";
import "./git.css";

/*
 * Git, in the top bar after the project's name (the open dialog has none of it):
 * - the branch chip: what's checked out (● uncommitted changes), or the branch whose newest commit is
 *   shown; its panel: Fetch, Update project, the working tree and every branch (read from a
 *   temporary copy: the checkout isn't touched);
 * - Compare: a panel of open pull / merge requests and branches; picking one shows what it changes
 *   against the base chosen at its top (from the merge-base by default).
 */

type Diff = NonNullable<ScanSettings["diff"]>;
const SOURCE_KEY = (root: string) => `rae.requestSource:${root}`;
const SOURCES: { value: RequestSource; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "gh", label: "GitHub CLI" },
  { value: "glab", label: "GitLab CLI" },
  { value: "git", label: "git (no titles)" },
];

/** "2h ago", "3d ago": when a request was last updated. */
function ago(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return undefined;
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 60 / 24)}d ago`;
}

const numberOf = (r: GitRequest) => `${r.provider === "github" ? "#" : "!"}${r.number}`;

/** The branch to compare with by default: origin's default branch, else main / master, else the first. */
function defaultBase(git: GitOverview): string {
  const names = git.branches.map((b) => b.name);
  const repo = git.repo;
  return [repo?.defaultBranch, repo?.defaultBranch && `origin/${repo.defaultBranch}`, "main", "master"].find((n): n is string => !!n && names.includes(n)) ?? names[0] ?? "";
}

export function GitControls() {
  const snapshot = useExplorer((s) => s.snapshot);
  const snapshotName = useExplorer((s) => s.snapshotName);
  const dir = snapshot?.rootDir;
  const [loaded, setLoaded] = useState<{ dir: string; git: GitOverview }>();
  const git = loaded?.dir === dir ? loaded?.git : undefined;

  // the open project's repo, asked again with each snapshot (the branch may have changed)
  useEffect(() => {
    if (!dir) return;
    let live = true;
    fetchGit(dir)
      .then((g) => live && setLoaded({ dir, git: g }))
      .catch(() => live && setLoaded({ dir, git: { repo: null, branches: [] } }));
    return () => {
      live = false;
    };
  }, [dir, snapshotName]);

  if (!dir || !git?.repo) return null;
  // what's on screen: a comparison, a branch's newest commit, or the working tree
  const shown: View | undefined = snapshot?.diff ? undefined : snapshot?.commit ? { kind: "branch", branch: snapshot.commit.ref } : { kind: "worktree" };
  return (
    <>
      <BranchChip dir={dir} git={git} shown={shown} onRepo={(g) => setLoaded({ dir, git: g })} />
      <ComparePanel git={git} repo={git.repo} comparing={!!snapshot?.diff} onCompare={(diff) => void read(dir, { diff })} onStop={() => void openView(dir, { kind: "worktree" })} />
    </>
  );
}

/** A branch a search finds: by its full name (`feat/login`, `origin/feat/login` too), its last commit's author or message. */
const matches = (b: GitBranch, q: string) => {
  if (!q) return true;
  const name = b.name.toLowerCase();
  return name.includes(q) || (!b.remote && `origin/${name}`.includes(q)) || b.subject.toLowerCase().includes(q) || !!b.author?.toLowerCase().includes(q);
};

const sameBranch = (a: string, b: string) => a.replace(/^origin\//, "") === b.replace(/^origin\//, "");

/**
 * The branch chip: what the diagram shows (the checkout's branch, or another branch's newest commit),
 * and its panel — Fetch, Update project (pull, fast-forward only), the working tree, and every branch
 * under a search; picking one shows its newest commit (its cache at once, refreshed behind it).
 */
function BranchChip({ dir, git, shown, onRepo }: { dir: string; git: GitOverview; shown?: View; onRepo: (g: GitOverview) => void }) {
  const repo = git.repo!;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"fetch" | "pull">();
  const [note, setNote] = useState<{ text: string; bad?: boolean }>();
  const viewing = shown?.kind === "branch" ? shown.branch : undefined;
  const name = viewing ?? repo.branch ?? repo.head.slice(0, 7);

  // branches: the default one first, then local ones, then origin's not checked out here (one row each)
  const q = query.trim().toLowerCase();
  // one row per branch (a local one stands for its origin twin), grouped by prefix under sticky headers
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const rows: GitBranch[] = [];
    for (const b of [...git.branches.filter((b) => !b.remote), ...git.branches.filter((b) => b.remote)]) {
      const short = b.name.replace(/^origin\//, "");
      if (seen.has(short)) continue;
      seen.add(short);
      if (matches(b, q)) rows.push(b);
    }
    return groupByPrefix(rows.slice(0, 200), (b) => b.name, (b) => b.remote, (remote) => (remote ? "origin" : "local"));
  }, [git.branches, q]);

  const act = async (action: "fetch" | "pull") => {
    setBusy(action);
    setNote(undefined);
    try {
      const g = await gitAction(action, dir);
      // another project opened meanwhile (a pull can take a while): its chip and diagram aren't touched
      if (useExplorer.getState().snapshot?.rootDir !== dir) return;
      onRepo(g);
      if (g.error) setNote({ text: g.error, bad: true });
      else if (action === "fetch") setNote({ text: "Fetched: branches are up to date with origin" });
      else {
        const moved = g.repo && g.repo.head !== repo.head;
        setNote({ text: moved ? `Updated ${repo.branch} to ${g.repo!.head.slice(0, 7)}` : `${repo.branch} is already up to date` });
        // the working tree changed: read it again (quietly, the diagram stays)
        if (moved && shown?.kind === "worktree") void read(dir, {}, true);
      }
    } catch (e) {
      setNote({ text: (e as Error).message, bad: true });
    } finally {
      setBusy(undefined);
    }
  };
  const pick = (view: View) => {
    setOpen(false);
    void openView(dir, view);
  };
  const canPull = !!repo.remote && !!repo.branch && !repo.dirty;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQuery("");
          setNote(undefined);
        }
      }}
      label="Branches"
      placement="bottom-start"
      width="440px"
      trigger={
        <chakra.button
          type="button"
          className="rae-git-chip"
          aria-haspopup="dialog"
          aria-label={`Branch ${name}${repo.dirty && !viewing ? ", uncommitted changes" : ""}: branches, fetch, update`}
          title={viewing ? `The newest commit of ${viewing}` : `${repo.branch ?? "Detached HEAD"}${repo.dirty ? " · uncommitted changes" : ""}`}
        >
          <IconBranch size={14} />
          <span className="rae-git-chip__name">{name}</span>
          {viewing && <span className="rae-git-chip__tag">latest</span>}
          {repo.dirty && !viewing && <span className="rae-git-chip__dirty" aria-hidden />}
          <IconChevronDown size={13} />
        </chakra.button>
      }
    >
      <Flex align="center" gap="2" px="3.5" py="2.5" borderBottomWidth="1px" borderColor="border" fontSize={textPx(12.5)}>
        <Text flex="1" minW="0" truncate color="fg.muted">
          {repo.branch ? (
            <>
              On{" "}
              <Text as="span" fontFamily="mono" color="fg">
                {repo.branch}
              </Text>
            </>
          ) : (
            `Detached at ${repo.head.slice(0, 7)}`
          )}
          {repo.dirty ? " · uncommitted changes" : ""}
        </Text>
        <Button size="xs" variant="outline" rounded="l2" onClick={() => void act("fetch")} disabled={!!busy || !repo.remote} title={repo.remote ? `git fetch: origin's branches and their newest commits (${remoteLabel(repo.remote.url)})` : "No origin remote"}>
          {busy === "fetch" ? <Spinner size="xs" /> : <IconRescan size={13} />} Fetch
        </Button>
        <Button
          size="xs"
          variant="outline"
          rounded="l2"
          onClick={() => void act("pull")}
          disabled={!!busy || !canPull}
          title={!repo.remote ? "No origin remote" : !repo.branch ? "Not on a branch" : repo.dirty ? "Uncommitted changes: commit or stash them first" : `Pull ${repo.branch} from origin (fast-forward only: nothing is merged)`}
        >
          {busy === "pull" ? <Spinner size="xs" /> : <IconArrowDown size={13} />} Update project
        </Button>
      </Flex>
      {note && (
        <Text px="3.5" py="2" fontSize={textPx(12)} color={note.bad ? "diff.removed.fg" : "diff.added.fg"} borderBottomWidth="1px" borderColor="border" role="status">
          {note.text}
        </Text>
      )}
      <Box p="2" pb="1">
        <chakra.button type="button" className="rae-git-branch rae-git-branch--row" aria-current={shown?.kind === "worktree" || undefined} onClick={() => pick({ kind: "worktree" })}>
          <span className="rae-git-branch__name" style={{ fontFamily: "inherit", fontWeight: 500 }}>
            Working tree
          </span>
          <span className="rae-git-branch__note">what's on disk{repo.dirty ? ", uncommitted changes included" : ""}</span>
        </chakra.button>
      </Box>
      <Flex align="center" gap="2" mx="3" my="1.5" h="30px" px="2.5" rounded="l2" borderWidth="1px" borderColor="border.emphasized" bg="bg.subtle" color="fg.subtle">
        <IconSearch size={13} />
        <chakra.input flex="1" minW="0" bg="transparent" outline="none" color="fg" fontSize={textPx(12.5)} placeholder="Search branches…" aria-label="Search branches" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </Flex>
      <Box overflowY="auto" maxH="min(50vh, 380px)" px="2" pb="2">
        <Text textStyle="panelLabel" color="fg.subtle" px="2.5" pt="1.5" pb="1">
          Branches · their newest commit
        </Text>
        {!groups.length && <Note>{q ? "No branch matches." : "No branches."}</Note>}
        {groups.map((g) => (
          <Box key={g.label} role="group" aria-label={g.label}>
            <div className="rae-git-group">{g.label}</div>
            {g.rows.map(({ item: b, rest }) => (
              <chakra.button
                key={b.ref}
                type="button"
                className="rae-git-branch"
                aria-current={(viewing && sameBranch(viewing, b.name)) || undefined}
                onClick={() => pick({ kind: "branch", branch: b.name })}
                title={`${b.name}: ${b.subject}`}
              >
                <span className="rae-git-branch__name">
                  {rest}
                  {repo.defaultBranch && sameBranch(b.name, repo.defaultBranch) ? <span className="rae-git-branch__tag">default</span> : null}
                  {repo.branch && sameBranch(b.name, repo.branch) ? <span className="rae-git-branch__tag">checked out</span> : null}
                </span>
                <span className="rae-git-branch__note">
                  <Author name={b.author} />
                  {b.subject}
                </span>
              </chakra.button>
            ))}
          </Box>
        ))}
      </Box>
    </Popover>
  );
}

/** The Compare button and its panel: pick a pull / merge request or a branch, see what it changes against the base. */
function ComparePanel({ git, repo, comparing, onCompare, onStop }: { git: GitOverview; repo: GitRepo; comparing: boolean; onCompare: (d: Diff) => void; onStop: () => void }) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState(() => defaultBase(git));
  const [mergeBase, setMergeBase] = useState(true);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<RequestSource>(() => readSetting<RequestSource>(SOURCE_KEY(repo.root), "auto"));
  const [requests, setRequests] = useState<{ key: string; list?: GitRequestList; error?: string }>();
  const key = `${repo.root}\n${source}`;
  const listed = requests?.key === key ? requests : undefined;

  // the base follows the repo (another project opened)
  const [baseFor, setBaseFor] = useState(repo.root);
  if (baseFor !== repo.root) {
    setBaseFor(repo.root);
    setBase(defaultBase(git));
  }

  // requests are listed when the panel opens (a network call), once per repo and source
  const loading = open && !!repo.remote && !listed;
  useEffect(() => {
    if (!loading) return;
    let live = true;
    fetchGitRequests(repo.root, source)
      .then((list) => live && setRequests({ key, list, error: list.error }))
      .catch((e: Error) => live && setRequests({ key, error: e.message }));
    return () => {
      live = false;
    };
  }, [loading, key, repo.root, source]);

  const q = query.trim().toLowerCase();
  const prs = useMemo(
    () => (listed?.list?.requests ?? []).filter((r) => !q || [numberOf(r), r.title, r.author, r.headBranch].some((s) => s?.toLowerCase().includes(q))),
    [listed, q],
  );
  const branchGroups = useMemo(() => {
    const seen = new Set<string>();
    const out: GitBranch[] = [];
    // local ones first, then remote ones not checked out locally
    for (const b of [...git.branches.filter((b) => !b.remote), ...git.branches.filter((b) => b.remote)]) {
      const short = b.remote ? b.name.replace(/^[^/]+\//, "") : b.name;
      if (seen.has(short) || b.name === base || short === base || b.name === repo.branch) continue;
      seen.add(short);
      if (matches(b, q)) out.push(b);
    }
    return groupByPrefix(out.slice(0, 200), (b) => b.name, (b) => b.remote, (remote) => (remote ? "origin" : "local"));
  }, [git.branches, base, repo.branch, q]);
  // requests by their branch's prefix (`renovate`, `feat`…); the card shows the rest of the branch
  const prGroups = useMemo(() => groupByPrefix(prs, (r) => r.headBranch, () => false, () => "other branches"), [prs]);

  const against = mergeBase ? "merge-base" : "base";
  const pick = (d: Diff) => {
    setOpen(false);
    onCompare(d);
  };
  const pickRequest = (r: GitRequest) => {
    // compared with the branch it merges into, when that branch is here
    const names = new Set(git.branches.map((b) => b.name));
    const into = r.baseBranch && [r.baseBranch, `origin/${r.baseBranch}`].find((n) => names.has(n));
    pick({ base: into || base, request: r.ref, against, ...(r.title || r.url ? { requestInfo: { title: r.title, author: r.author, url: r.url } } : {}) });
  };
  const sourceName = listed?.list ? { gh: "GitHub CLI", glab: "GitLab CLI", git: "git" }[listed.list.source] : undefined;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Compare"
      placement="bottom-start"
      width="780px"
      trigger={
        <chakra.button type="button" className="rae-git-compare" data-on={comparing || undefined} aria-haspopup="dialog" title="Compare a pull request or branch with its base: what it changes">
          <IconDiff size={14} /> Compare
        </chakra.button>
      }
    >
      <Flex align="center" gap="3" px="3.5" py="2.5" borderBottomWidth="1px" borderColor="border" fontSize={textPx(12.5)} color="fg.muted" wrap="wrap">
        <Text fontWeight="semibold" fontSize={textPx(14)} color="fg">
          Compare with
        </Text>
        <Box w="200px">
          <SearchSelect label="Base branch" value={base} onValueChange={setBase} options={branchOptions(git.branches, (n) => n)} width="full" size="xs" placeholder="Search branches…" emptyText="No branch matches" />
        </Box>
        <Switch size="xs" checked={mergeBase} onCheckedChange={setMergeBase}>
          <Text as="span" fontSize={textPx(12)} title="What a pull request shows: later commits on the base left out">
            from the merge-base
          </Text>
        </Switch>
        <Box flex="1" />
        <Flex align="center" gap="2" w="220px" h="30px" px="2.5" rounded="l2" borderWidth="1px" borderColor="border.emphasized" bg="bg.subtle" color="fg.subtle">
          <IconSearch size={13} />
          <chakra.input flex="1" minW="0" bg="transparent" outline="none" color="fg" fontSize={textPx(12.5)} placeholder="Search" aria-label="Search pull requests and branches" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Flex>
      </Flex>

      <Box display="grid" gridTemplateColumns="minmax(0, 1.3fr) minmax(0, 1fr)" h="min(56vh, 440px)">
        <Box overflowY="auto" minH="0" p="2" borderRightWidth="1px" borderColor="border">
          <Flex align="center" gap="2" px="2.5" pt="1" pb="1.5">
            <Text textStyle="panelLabel" color="fg.subtle" flex="1">
              {repo.remote?.provider === "gitlab" ? "Open merge requests" : "Open pull requests"}
              {sourceName ? ` · ${sourceName}` : ""}
            </Text>
            <Box w="130px" title="Where they're listed from: Auto uses the host's CLI (gh / glab) when logged in, else git">
              <Select label="List them from" value={source} onValueChange={(v) => (writeSetting(SOURCE_KEY(repo.root), v), setSource(v as RequestSource))} options={SOURCES} width="full" size="xs" />
            </Box>
          </Flex>
          {!repo.remote && <Note>No origin remote: there are no pull requests to list.</Note>}
          {loading && (
            <Flex align="center" gap="2" px="2.5" py="2" color="fg.muted" fontSize={textPx(12)}>
              <Spinner size="xs" /> Listing them…
            </Flex>
          )}
          {listed?.error && <Note>{listed.error}</Note>}
          {listed?.list && !prs.length && !listed.error && <Note>{q ? "None matches." : "None open."}</Note>}
          {listed?.list?.fallback && <Note>{listed.list.fallback}</Note>}
          {prGroups.map((g) => (
            <Box key={g.label} role="group" aria-label={g.label}>
              <div className="rae-git-group">{g.label}</div>
              {g.rows.map(({ item: r, rest }) => (
                <chakra.button key={r.ref} type="button" className="rae-git-pr" onClick={() => pickRequest(r)} title={r.headBranch}>
                  <span className="rae-git-pr__num">{numberOf(r)}</span>
                  <span className="rae-git-pr__title">{r.title ?? r.headBranch ?? r.sha.slice(0, 7)}</span>
                  <span className="rae-git-pr__meta">
                    <Author name={r.author} />
                    {[r.headBranch ? rest : undefined, r.draft ? "draft" : undefined, r.baseBranch ? `→ ${r.baseBranch}` : undefined, ago(r.updatedAt) && `updated ${ago(r.updatedAt)}`].filter(Boolean).join(" · ")}
                  </span>
                </chakra.button>
              ))}
            </Box>
          ))}
        </Box>
        <Box overflowY="auto" minH="0" p="2">
          <Text textStyle="panelLabel" color="fg.subtle" px="2.5" pt="1" pb="1.5">
            Your checkout
          </Text>
          {repo.dirty && (
            <BranchRow name={repo.branch ?? repo.head.slice(0, 7)} note="with uncommitted changes" onPick={() => pick({ base, worktree: true, against })} />
          )}
          <BranchRow name={repo.branch ?? repo.head.slice(0, 7)} note={repo.dirty ? "its last commit" : "checked out"} onPick={() => pick({ base, head: "HEAD", against })} />
          <Text textStyle="panelLabel" color="fg.subtle" px="2.5" pt="3" pb="1.5">
            Branches
          </Text>
          {!branchGroups.length && <Note>{q ? "None matches." : "No other branch."}</Note>}
          {branchGroups.map((g) => (
            <Box key={g.label} role="group" aria-label={g.label}>
              <div className="rae-git-group">{g.label}</div>
              {g.rows.map(({ item: b, rest }) => (
                <BranchRow key={b.ref} name={rest} author={b.author} note={b.subject} title={b.name} onPick={() => pick({ base, head: b.name, against })} />
              ))}
            </Box>
          ))}
        </Box>
      </Box>

      <Flex align="center" gap="2" px="3.5" py="2.5" borderTopWidth="1px" borderColor="border" fontSize={textPx(12)} color="fg.muted">
        <Text flex="1">
          Pick one: the diagram shows what it changes, against{" "}
          <Text as="span" fontFamily="mono" color="fg">
            {base}
          </Text>
          .
        </Text>
        {comparing && (
          <chakra.button
            type="button"
            className="rae-git-stop"
            onClick={() => {
              setOpen(false);
              onStop();
            }}
          >
            Stop comparing
          </chakra.button>
        )}
      </Flex>
    </Popover>
  );
}

function BranchRow({ name, author, note, title, onPick }: { name: string; author?: string; note?: string; title?: string; onPick: () => void }) {
  return (
    <chakra.button type="button" className="rae-git-branch" onClick={onPick} title={title ? `${title}${note ? `: ${author ? `${author} · ` : ""}${note}` : ""}` : note}>
      <span className="rae-git-branch__name">{name}</span>
      {(note || author) && (
        <span className="rae-git-branch__note">
          <Author name={author} />
          {note}
        </span>
      )}
    </chakra.button>
  );
}

/** Who: bold, before the rest of the line (`ann · fix the footer`). */
const Author = ({ name }: { name?: string }) =>
  name ? (
    <>
      <b className="rae-git-author">{name}</b>
      {" · "}
    </>
  ) : null;

const Note = ({ children }: { children: React.ReactNode }) => (
  <Text px="2.5" py="1.5" fontSize={textPx(12)} color="fg.muted">
    {children}
  </Text>
);
