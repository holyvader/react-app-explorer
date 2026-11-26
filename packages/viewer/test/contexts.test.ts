import { describe, expect, test } from "bun:test";
import type { GraphNode, HookUsage, JsxNode, Snapshot } from "@rae/schema";
import { contextOfCall, contextsProvided, contextsRead, contextUses } from "../src/lib/contexts.ts";

const loc = { line: 1, col: 1 };
const call = (hook: string, args: string[], targetId?: string): HookUsage => ({ hook, args, targetId, loc });
const hook = (id: string, hooksUsed: HookUsage[]): GraphNode => ({ id, kind: "hook", name: id, filePath: "src/x.ts", hooksUsed });
const snap = (...nodes: GraphNode[]) => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) }) as unknown as Snapshot;
const el = (tag: string, props: string[] = [], children: JsxNode[] = []): JsxNode => ({ tag, native: false, props: props.map((name) => ({ name })), conditions: [], loc, children });

describe("contexts", () => {
  test("useContext(X), React.useContext(X) and use(XContext) read a context; use(promise) doesn't", () => {
    expect(contextOfCall(call("useContext", ["CurrencyContext"]))).toBe("CurrencyContext");
    expect(contextOfCall(call("React.useContext", ["Ctx.Theme"]))).toBe("Ctx.Theme");
    expect(contextOfCall(call("use", ["ThemeContext"]))).toBe("ThemeContext");
    expect(contextOfCall(call("use", ["dataPromise"]))).toBeUndefined();
    expect(contextOfCall(call("useContext", ["getCtx()"]))).toBeUndefined();
    expect(contextOfCall(call("useState", ["CurrencyContext"]))).toBeUndefined();
  });

  test("read directly or through the project's hooks, named by the nearest one", () => {
    const inner = hook("useCurrencyContext", [call("useContext", ["CurrencyContext"])]);
    const outer = hook("useCurrency", [call("useCurrencyContext", [], inner.id), call("useContext", ["ThemeContext"])]);
    const node = hook("useSeat", [call("useCurrency", [], outer.id), call("useCurrencyContext", [], inner.id)]);
    expect(contextsRead(snap(inner, outer, node), node)).toEqual([
      { name: "ThemeContext", via: "useCurrency" },
      { name: "CurrencyContext", via: "useCurrencyContext" },
    ]);
    expect(contextsRead(snap(inner), inner)).toEqual([{ name: "CurrencyContext", via: undefined }]);
  });

  test("hooks calling each other don't loop", () => {
    const a = hook("useA", [call("useB", [], "useB")]);
    const b = hook("useB", [call("useA", [], "useA"), call("useContext", ["BContext"])]);
    expect(contextsRead(snap(a, b), a)).toEqual([{ name: "BContext", via: "useB" }]);
  });

  test("a component provides <X.Provider> and <XContext value>", () => {
    const node: GraphNode = {
      id: "P",
      kind: "component",
      name: "P",
      filePath: "src/P.tsx",
      renderTree: [el("CurrencyContext.Provider", ["value"], [el("ThemeContext", ["value"], [el("OtherContext")])])],
    };
    expect(contextsProvided(node)).toEqual(["CurrencyContext", "ThemeContext"]);
  });
});

describe("context uses across the project", () => {
  test("providers and readers by name, readers through hooks included", () => {
    const inner = hook("useCurrencyContext", [call("useContext", ["CurrencyContext"])]);
    const outer = hook("useCurrency", [call("useCurrencyContext", [], inner.id)]);
    const provider: GraphNode = { id: "Provider", kind: "component", name: "Provider", filePath: "src/P.tsx", renderTree: [el("CurrencyContext.Provider", ["value"])] };
    const s = snap(inner, outer, provider);
    const use = contextUses(s).get("CurrencyContext")!;
    expect(use.providers).toEqual(["Provider"]);
    expect(use.readers.sort()).toEqual(["useCurrency", "useCurrencyContext"]);
    expect(contextUses(s)).toBe(contextUses(s));
  });
});
