import type { PropDef } from "@rae/schema";
import { API, SignatureKind, SymbolFlags, type Type } from "typescript/async";
import type { DeclExtract, FileExtract, RawFn, RawHook } from "../extract/types.ts";

/**
 * Type enrichment via TypeScript 7 (Go, tsgo) through its async IPC API.
 * oxc already located every position of interest; here we only ask the checker about
 * those offsets, one batched `getTypeAtPosition` per file, with follow-ups pipelined.
 */

const MAX_TYPE = 200;
const MAX_PROPS = 40;
const FILE_CONCURRENCY = 48;

type Checker = Awaited<ReturnType<typeof openChecker>>["checker"];
type TType = Type;

function clip(s: string): string {
  return s.length > MAX_TYPE ? s.slice(0, MAX_TYPE - 1) + "…" : s;
}

async function openChecker(rootDir: string, files: string[], tsconfig?: string) {
  // Packaged apps ship the native TypeScript binary next to the executable (it can't run from inside
  // a compiled Bun binary): RAE_TSGO_PATH points at it. Otherwise the typescript package finds its own.
  const api = new API({ cwd: rootDir, ...(process.env.RAE_TSGO_PATH ? { tsserverPath: process.env.RAE_TSGO_PATH } : {}) });
  const snapshot = await api.createSnapshot(tsconfig ? { openProjects: [tsconfig] } : { openFiles: files });
  const project = snapshot.getProjects()[0];
  if (!project) throw new Error("tsgo: no project loaded");
  return { api, snapshot, checker: project.checker };
}

export interface TypesResult {
  queried: number;
  skipped: number;
  failed: number;
}

export async function applyTypes(
  files: FileExtract[],
  opts: { rootDir: string; tsconfig?: string; keyOf: (f: FileExtract) => string; onWarn?: (m: string) => void },
): Promise<TypesResult> {
  const todo = files.filter((f) => f.decls.length && f.typesKey !== opts.keyOf(f));
  const res: TypesResult = { queried: 0, skipped: files.length - todo.length, failed: 0 };
  if (!todo.length) return res;

  const { api, snapshot, checker: mainChecker } = await openChecker(
    opts.rootDir,
    todo.map((f) => f.absPath),
    opts.tsconfig,
  );
  const retry: FileExtract[] = [];
  await runAll(todo, makeProcessor(mainChecker, opts.keyOf), res, opts.onWarn, retry);

  // Files outside the tsconfig program (scripts, configs...): open them so tsgo picks their default project.
  if (retry.length) {
    try {
      const snap2 = await snapshot.update({ openFiles: retry.map((f) => f.absPath) });
      const byProject = new Map<string, { checker: Checker; files: FileExtract[] }>();
      for (const f of retry) {
        const project = await snap2.getDefaultProjectForFile(f.absPath);
        if (!project) {
          res.failed++;
          continue;
        }
        const entry = byProject.get(String(project.id)) ?? { checker: project.checker, files: [] };
        entry.files.push(f);
        byProject.set(String(project.id), entry);
      }
      for (const { checker, files: group } of byProject.values()) {
        await runAll(group, makeProcessor(checker, opts.keyOf), res, opts.onWarn);
      }
    } catch (e) {
      res.failed += retry.length;
      opts.onWarn?.(`types: fallback projects failed: ${(e as Error).message}`);
    }
  }
  await api.close();
  return res;
}

async function runAll(
  files: FileExtract[],
  processFile: (f: FileExtract) => Promise<void>,
  res: TypesResult,
  onWarn: ((m: string) => void) | undefined,
  retry?: FileExtract[],
) {
  // Bounded concurrency across files; requests are pipelined over the IPC channel.
  let i = 0;
  const runners = Array.from({ length: Math.min(FILE_CONCURRENCY, files.length) }, async () => {
    while (i < files.length) {
      const f = files[i++]!;
      try {
        await processFile(f);
        res.queried++;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (retry && msg.includes("source file not found")) {
          retry.push(f);
          continue;
        }
        res.failed++;
        if (res.failed <= 5) onWarn?.(`types: ${f.absPath}: ${msg}`);
      }
    }
  });
  await Promise.all(runners);
}

function makeProcessor(checker: Checker, keyOf: (f: FileExtract) => string) {
  const str = (t: TType | undefined) => (t ? checker.typeToString(t).then(clip) : Promise.resolve(undefined));

  async function signatureOf(t: TType | undefined) {
    if (!t) return undefined;
    const [sig] = await checker.getSignaturesOfType(t, SignatureKind.Call);
    if (!sig) return undefined;
    const [params, ret] = await Promise.all([sig.getParameters(), checker.getReturnTypeOfSignature(sig)]);
    const paramTypes = params.length ? await checker.getTypeOfSymbol(params) : [];
    return { paramTypes, ret };
  }

  async function fillFn(target: DeclExtract | RawFn, t: TType | undefined) {
    const sig = await signatureOf(t);
    if (!sig) return undefined;
    const [ret, ...ptypes] = await Promise.all([str(sig.ret), ...sig.paramTypes.map(str)]);
    target.returnType = ret ?? target.returnType;
    target.params.forEach((p, i) => {
      if (ptypes[i]) p.type = ptypes[i];
    });
    return sig;
  }

  async function propsOf(t: TType): Promise<PropDef[]> {
    const syms = (await checker.getPropertiesOfType(t)).slice(0, MAX_PROPS);
    if (!syms.length) return [];
    const types = await checker.getTypeOfSymbol(syms);
    const strs = await Promise.all(types.map(str));
    return syms.map((s, i) => ({ name: s.name, type: strs[i], optional: !!(s.flags & SymbolFlags.Optional) }));
  }

  async function fillHook(h: RawHook, types: (TType | undefined)[], calleeType: TType | undefined) {
    if (h.bindingPositions.length === 0) {
      const sig = await signatureOf(calleeType);
      h.returnType = sig ? await str(sig.ret) : undefined;
      return;
    }
    const strs = await Promise.all(types.map(str));
    if (h.bindingPositions.length === 1 && !h.arrayPattern) h.returnType = strs[0];
    else if (h.arrayPattern) h.returnType = clip(`[${strs.map((s) => s ?? "unknown").join(", ")}]`);
    else h.returnType = clip(`{ ${h.bindingNames.map((n, i) => `${n}: ${strs[i] ?? "unknown"}`).join("; ")} }`);
  }

  async function processFile(f: FileExtract) {
    // Collect all positions for one batched request.
    const positions: number[] = [];
    const slot = (pos: number) => positions.push(pos) - 1;
    const plan = f.decls.map((d) => ({
      d,
      self: slot(d.pos),
      fns: d.functions.map((fn) => slot(fn.pos)),
      hooks: d.hooks.map((h) => ({
        h,
        bindings: h.bindingPositions.map(slot),
        callee: h.bindingPositions.length ? -1 : slot(h.calleePos),
      })),
    }));
    const types = await checker.getTypeAtPosition(f.absPath, positions);
    const at = (i: number) => (i >= 0 ? types[i] : undefined);

    await Promise.all(
      plan.flatMap(({ d, self, fns, hooks }) => [
        (async () => {
          const sig = await fillFn(d, at(self));
          if (d.kind === "component" && sig?.paramTypes[0]) {
            const props = await propsOf(sig.paramTypes[0]);
            if (props.length) d.props = mergeProps(d.props, props);
          }
        })(),
        ...d.functions.map((fn, i) => fillFn(fn, at(fns[i]!))),
        ...hooks.map(({ h, bindings, callee }) => fillHook(h, bindings.map(at), at(callee))),
      ]),
    );
    f.typesKey = keyOf(f);
  }

  return processFile;
}

/** Keep syntactic info (defaults) while preferring checker types. */
function mergeProps(syntactic: PropDef[] | undefined, checked: PropDef[]): PropDef[] {
  const byName = new Map((syntactic ?? []).map((p) => [p.name, p]));
  const merged: PropDef[] = checked.map((p) => ({ ...p, default: byName.get(p.name)?.default }));
  for (const p of syntactic ?? []) if (p.name.startsWith("...")) merged.push(p);
  return merged;
}

