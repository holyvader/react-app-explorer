import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { followRun, LOCAL_URL, listScripts, runScript, stopRun, type RunEvent, type RunSummary } from "../src/scripts.ts";

const dir = mkdtempSync(join(tmpdir(), "rae-scripts-"));
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({
    name: "demo",
    scripts: { hello: "echo hello && echo oops 1>&2", fail: "exit 3", serve: "echo 'Local: http://localhost:4321/' && sleep 30", dot: "echo 'listening on http://localhost:3000.' && sleep 30", odd: 42 },
  }),
);
writeFileSync(join(dir, "bun.lock"), "");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Everything a run printed, and how it ended. */
function finished(id: string): Promise<{ out: string; run: RunSummary }> {
  return new Promise((done) => {
    let out = "";
    followRun(id, 0, (e: RunEvent) => {
      if (e.type === "out") out += e.text;
      else done({ out, run: e.run });
    });
  });
}

describe("package.json scripts", () => {
  test("lists the scripts (strings only) and the package manager from the lockfile", () => {
    const info = listScripts(dir);
    expect(info).toMatchObject({ dir, name: "demo", manager: "bun", scripts: { hello: "echo hello && echo oops 1>&2", fail: "exit 3" } });
    expect("odd" in (info as { scripts: object }).scripts).toBe(false);
    expect(listScripts(join(dir, "nope"))).toHaveProperty("error");
  });

  test("runs a script by name: its output, both streams, and how it ended", async () => {
    const run = await runScript(dir, "hello");
    if ("error" in run) throw new Error(run.error);
    const { out, run: end } = await finished(run.id);
    expect(out).toContain("hello");
    expect(out).toContain("oops");
    expect(end).toMatchObject({ status: "exited", exitCode: 0 });

    const bad = await runScript(dir, "fail");
    if ("error" in bad) throw new Error(bad.error);
    expect((await finished(bad.id)).run).toMatchObject({ status: "failed", exitCode: 3 });
  }, 20000);

  test("only scripts the package.json names", async () => {
    expect(await runScript(dir, "rm -rf /")).toHaveProperty("error");
    expect(await runScript(dir, "odd")).toHaveProperty("error");
  });

  test("a dev server: its address is found, it keeps running, and stopping it ends it", async () => {
    const run = await runScript(dir, "serve");
    if ("error" in run) throw new Error(run.error);
    const ended = finished(run.id);
    for (let i = 0; i < 100 && !run.url; i++) await Bun.sleep(50);
    expect(run.url).toBe("http://localhost:4321/");
    expect(run.status).toBe("running");
    // running already: the same run, not a second one
    expect(await runScript(dir, "serve")).toMatchObject({ id: run.id });
    stopRun(run.id);
    // ended by Stop: "stopped", not "failed"
    expect((await ended).run.status).toBe("stopped");
  }, 20000);

  test("an address followed by punctuation is found without it", async () => {
    const run = await runScript(dir, "dot");
    if ("error" in run) throw new Error(run.error);
    const ended = finished(run.id);
    for (let i = 0; i < 100 && !run.url; i++) await Bun.sleep(50);
    expect(run.url).toBe("http://localhost:3000");
    stopRun(run.id);
    await ended;
  }, 20000);

  test("two requests to run a script at once start it once", async () => {
    const [a, b] = await Promise.all([runScript(dir, "serve"), runScript(dir, "serve")]);
    if ("error" in a || "error" in b) throw new Error("couldn't start");
    expect(b.id).toBe(a.id);
    const ended = finished(a.id);
    stopRun(a.id);
    await ended;
  }, 20000);

  test("local addresses: trailing punctuation left out, paths kept", () => {
    const find = (t: string) => LOCAL_URL.exec(t)?.[0];
    expect(find("at http://localhost:3000.")).toBe("http://localhost:3000");
    expect(find("at http://localhost:3000, ready")).toBe("http://localhost:3000");
    expect(find("➜ Local: http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(find("see http://127.0.0.1:8080/docs/api.")).toBe("http://127.0.0.1:8080/docs/api");
  });
});
