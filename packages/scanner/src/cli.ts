#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { discoverProject } from "./project.ts";
import { runScanJob } from "./job.ts";
import { scan, writeSnapshot } from "./scan.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tsconfig: { type: "string" },
    out: { type: "string", short: "o" },
    include: { type: "string", multiple: true },
    exclude: { type: "string", multiple: true },
    "no-types": { type: "boolean", default: false },
    "no-cache": { type: "boolean", default: false },
    workers: { type: "string" },
    stats: { type: "boolean", default: false },
    stdout: { type: "boolean", default: false },
    events: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`Usage: rae-scan <dir|entry-file> [options]

Options:
  --tsconfig <path>   tsconfig to use (default: nearest)
  -o, --out <dir>     snapshot output dir (default: <root>/.explorer/snapshots)
  --include <glob>    file globs to scan in dir mode (repeatable)
  --exclude <glob>    extra globs to exclude (repeatable)
  --no-types          skip the tsgo type pass (syntactic types only)
  --no-cache          ignore and don't write the incremental cache
  --workers <n>       max parser workers (default: cpus - 1)
  --stats             print phase timings
  --stdout            print the snapshot JSON to stdout instead of writing a file
  --events            write the snapshot and print progress events as NDJSON (for UIs)`);
  process.exit(positionals.length ? 0 : 1);
}

const input = resolve(positionals[0]!);

if (values.events) {
  // Structure first, then types in the background — one JSON event per line (see job.ts).
  const outDir = values.out ? resolve(values.out) : join((await discoverProject(input)).rootDir, ".explorer", "snapshots");
  await runScanJob(
    input,
    {
      outDir,
      tsconfig: values.tsconfig,
      include: values.include,
      exclude: values.exclude,
      types: !values["no-types"],
      cache: !values["no-cache"],
      maxWorkers: values.workers ? Number(values.workers) : undefined,
    },
    (e) => process.stdout.write(JSON.stringify(e) + "\n"),
  );
  process.exit(0);
}

const warnings: string[] = [];
const snapshot = await scan(input, {
  tsconfig: values.tsconfig,
  include: values.include,
  exclude: values.exclude,
  types: !values["no-types"],
  cache: !values["no-cache"],
  maxWorkers: values.workers ? Number(values.workers) : undefined,
  onWarn: (m) => warnings.push(m),
});

if (values.stdout) {
  process.stdout.write(JSON.stringify(snapshot));
} else {
  const outDir = values.out ? resolve(values.out) : join((await discoverProject(input)).rootDir, ".explorer", "snapshots");
  const path = writeSnapshot(snapshot, outDir);
  const nodes = Object.values(snapshot.nodes);
  const count = (k: string) => nodes.filter((n) => n.kind === k).length;
  console.log(
    `✔ ${snapshot.stats.files} files → ${nodes.length} nodes (${count("component")} components, ${count("hook")} hooks, ${count("serverAction")} actions, ${count("external")} external), ${snapshot.edges.length} edges in ${snapshot.stats.durationMs}ms`,
  );
  console.log(`  ${path}`);
}
if (values.stats) console.error("phases (ms):", snapshot.stats.phases, "cache hits:", snapshot.stats.cacheHits);
for (const w of warnings.slice(0, 20)) console.error(`⚠ ${w}`);
if (warnings.length > 20) console.error(`⚠ …and ${warnings.length - 20} more`);
process.exit(0);
