import { describe, expect, test, beforeAll } from "bun:test";
import type { Edge, Snapshot } from "@rae/schema";
import { scan } from "../src/scan.ts";

const fixture = (name: string) => new URL(`../../fixtures/${name}/`, import.meta.url).pathname;
const edge = (s: Snapshot, kind: Edge["kind"], from: string, to: string) =>
  s.edges.find((e) => e.kind === kind && e.from === from && e.to === to);

for (const types of [true, false]) {
  describe(`next-app (types: ${types})`, () => {
    let s: Snapshot;
    beforeAll(async () => {
      s = await scan(fixture("next-app"), { cache: false, types });
    });

    test("detects framework and next roles", () => {
      expect(s.framework).toBe("next-app");
      expect(s.nodes["app/page.tsx"]!.nextRole).toBe("page");
      expect(s.nodes["app/layout.tsx"]!.nextRole).toBe("layout");
    });

    test("classifies node kinds", () => {
      expect(s.nodes["app/page.tsx#HomePage"]!.kind).toBe("component");
      expect(s.nodes["hooks/useToggle.ts#useToggle"]!.kind).toBe("hook");
      expect(s.nodes["app/actions/todos.ts#addTodo"]!.kind).toBe("serverAction");
      expect(s.nodes["lib/format.ts#formatTitle"]!.kind).toBe("function");
      expect(s.nodes["ext:react"]!.kind).toBe("external");
      expect(s.nodes["ext:clsx"]!.kind).toBe("external");
    });

    test("propagates server/client boundaries", () => {
      expect(s.nodes["app/page.tsx"]!.moduleType).toBe("server");
      expect(s.nodes["components/TodoItem.tsx"]!.moduleType).toBe("client");
      expect(s.nodes["lib/format.ts"]!.moduleType).toBe("client"); // only imported from client
      expect(s.nodes["lib/data.ts"]!.moduleType).toBe("server"); // server-only
      expect(s.nodes["components/Header.tsx#Header"]!.moduleType).toBe("server");
    });

    test("import types: static, lazy, next-dynamic, type-only", () => {
      expect(edge(s, "imports", "app/dashboard/page.tsx", "components/Chart.tsx")!.importType).toBe("next-dynamic");
      expect(edge(s, "imports", "app/dashboard/page.tsx", "components/Stats.tsx")!.importType).toBe("lazy");
      expect(edge(s, "imports", "components/TodoItem.tsx", "lib/data.ts")!.importType).toBe("type-only");
      expect(edge(s, "imports", "app/page.tsx", "components/TodoList.tsx")!.importType).toBe("static");
    });

    test("render conditions", () => {
      expect(edge(s, "renders", "app/dashboard/page.tsx#DashboardPage", "components/Chart.tsx#Chart")!.conditions).toEqual([
        { kind: "ternary-true", expr: 'tab === "chart"' },
      ]);
      // memo(Stats) default export resolves to the Stats decl
      expect(edge(s, "renders", "app/dashboard/page.tsx#DashboardPage", "components/Stats.tsx#Stats")!.conditions![0]!.kind).toBe("ternary-false");
      expect(edge(s, "renders", "components/TodoList.tsx#TodoList", "components/TodoItem.tsx#TodoItem")!.conditions![0]!.kind).toBe("map");
      const todoList = edge(s, "renders", "app/page.tsx#HomePage", "components/TodoList.tsx#TodoList")!;
      expect(todoList.conditions!.map((c) => c.kind)).toEqual(["early-return", "suspense"]);
      const tree = s.nodes["app/page.tsx#HomePage"]!.renderTree!;
      expect(tree[0]!.tag).toBe("p");
      expect(tree[0]!.conditions).toEqual([{ kind: "if", expr: "!user" }]);
      const a = tree[1]!.children.find((c) => c.tag === "a")!;
      expect(a.native).toBe(true);
      expect(a.conditions).toEqual([{ kind: "and", expr: "user.isAdmin" }]);
    });

    test("hooks, invokes and server action invokes", () => {
      expect(edge(s, "usesHook", "components/AddTodoForm.tsx#AddTodoForm", "hooks/useToggle.ts#useToggle")).toBeDefined();
      expect(edge(s, "usesHook", "components/TodoItem.tsx#TodoItem", "ext:react")!.specifiers).toEqual(["useState"]);
      expect(edge(s, "invokesAction", "components/AddTodoForm.tsx#AddTodoForm", "app/actions/todos.ts#addTodo")).toBeDefined();
      expect(edge(s, "invokes", "app/page.tsx#HomePage", "lib/data.ts#getUser")).toBeDefined();
      const item = s.nodes["components/TodoItem.tsx#TodoItem"]!;
      expect(item.hooksUsed![0]!.assignedTo).toBe("[done, setDone]");
      expect(item.functions![0]!.name).toBe("toggle");
    });

    test("props and signatures", () => {
      const header = s.nodes["components/Header.tsx#Header"]!;
      const subtitle = header.props!.find((p) => p.name === "subtitle")!;
      expect(subtitle.optional).toBe(true);
      expect(subtitle.default).toBe('"sub"');
      expect(header.props!.find((p) => p.name === "title")!.type).toBe("string");
      expect(s.nodes["lib/format.ts#formatTitle"]!.signature!.returnType).toBe("string");
      if (types) {
        expect(s.nodes["hooks/useToggle.ts#useToggle"]!.signature!.returnType).toBe("{ on: boolean; toggle: () => void; }");
        expect(s.nodes["components/TodoItem.tsx#TodoItem"]!.hooksUsed![0]!.returnType).toBe(
          "[boolean, Dispatch<SetStateAction<boolean>>]",
        );
        expect(s.nodes["app/actions/todos.ts#addTodo"]!.signature!.returnType).toBe("Promise<{ ok: boolean; }>");
      }
    });
  });
}

describe("react-app", () => {
  let s: Snapshot;
  beforeAll(async () => {
    s = await scan(fixture("react-app"), { cache: false });
  });

  test("framework, module-level render and lazy import", () => {
    expect(s.framework).toBe("react");
    expect(edge(s, "renders", "src/main.tsx", "src/App.tsx#App")).toBeDefined();
    expect(edge(s, "imports", "src/App.tsx", "src/components/Settings.tsx")!.importType).toBe("lazy");
    expect(s.nodes["src/App.tsx"]!.moduleType).toBe("client");
  });

  test("switch-case conditions via local variable", () => {
    const e = edge(s, "renders", "src/App.tsx#App", "src/components/Settings.tsx#Settings")!;
    expect(e.conditions).toEqual([
      { kind: "switch-case", expr: 'view === "settings"' },
      { kind: "suspense", expr: "null" },
    ]);
  });

  test("props from interface with defaults", () => {
    const props = s.nodes["src/components/Button.tsx#Button"]!.props!;
    expect(props.map((p) => p.name)).toEqual(["label", "onClick", "variant"]);
    expect(props.find((p) => p.name === "variant")!.default).toBe('"primary"');
  });

  test("entry-file mode follows imports", async () => {
    const s2 = await scan(fixture("react-app") + "src/main.tsx", { cache: false, types: false });
    expect(Object.keys(s2.nodes)).toContain("src/components/Settings.tsx#Settings");
    expect(s2.entry).toBe("src/main.tsx");
  });
});

describe("invokes", () => {
  test("new Foo() and module-level calls create invokes edges", async () => {
    const s = await scan(fixture("next-app"), { cache: false, types: false });
    expect(edge(s, "invokes", "lib/store.ts#createStore", "lib/store.ts#TodoStore")).toBeDefined();
    expect(edge(s, "invokes", "lib/store.ts", "lib/store.ts#createStore")).toBeDefined();
    expect(s.schemaVersion).toBe(2);
  });
});
