import type { Condition, JsxProp } from "@rae/schema";
import type { RawJsxNode, RawRef } from "./types.ts";
import { containsJsx, isFunction, type N, type SourceText, unwrap, walk } from "./util.ts";

const MAP_METHODS = new Set(["map", "flatMap"]);
const FRAGMENTS = new Set(["Fragment", "React.Fragment"]);

interface VarEntry {
  expr: N;
  conds: Condition[];
}
type Vars = Map<string, VarEntry[]>;

/**
 * Builds the render tree of a function body, tracking the conditions that must hold
 * for each element to render (&&, ternaries, early returns, switch cases, .map, ...).
 */
export class JsxAnalyzer {
  constructor(private src: SourceText) {}

  analyzeFunction(fn: N): { tree: RawJsxNode[]; renders: RawRef[] } {
    const tree: RawJsxNode[] = [];
    this.visitFnBody(fn, [], tree, new Map(), 0);
    return { tree, renders: this.collectRenders(tree) };
  }

  /** Module-level JSX (e.g. `createRoot(el).render(<App />)`), outside of any declaration. */
  analyzeLoose(stmts: N[]): { tree: RawJsxNode[]; renders: RawRef[] } {
    const tree: RawJsxNode[] = [];
    for (const stmt of stmts) {
      walk(stmt, (n) => {
        if (isFunction(n) || n.type === "ClassDeclaration" || n.type === "ClassExpression") return false;
        if (n.type === "JSXElement" || n.type === "JSXFragment") {
          this.visitExpr(n, [], tree, new Map(), 0);
          return false;
        }
      });
    }
    return { tree, renders: this.collectRenders(tree) };
  }

  private collectRenders(tree: RawJsxNode[]): RawRef[] {
    const renders: RawRef[] = [];
    const collect = (nodes: RawJsxNode[], acc: Condition[]) => {
      for (const n of nodes) {
        const conds = n.conditions.length ? [...acc, ...n.conditions] : acc;
        if (n.ref) renders.push({ local: n.ref.local, member: n.ref.member, conditions: conds });
        collect(n.children, conds);
      }
    };
    collect(tree, []);
    return renders;
  }

  /** For class components: analyze the `render()` method. */
  analyzeClass(cls: N): { tree: RawJsxNode[]; renders: RawRef[] } {
    const render = cls.body?.body?.find(
      (m: N) => m.type === "MethodDefinition" && m.key?.name === "render" && isFunction(m.value),
    );
    return render ? this.analyzeFunction(render.value) : { tree: [], renders: [] };
  }

  private visitFnBody(fn: N, conds: Condition[], out: RawJsxNode[], vars: Vars, depth: number) {
    const body = fn.body;
    if (!body) return;
    if (body.type !== "BlockStatement") this.visitExpr(body, conds, out, vars, depth);
    else this.walkStatements(body.body, conds, out, new Map(vars), depth, conds.length);
  }

  /** Returns true if the statement list always returns. */
  private walkStatements(
    stmts: N[],
    conds: Condition[],
    out: RawJsxNode[],
    vars: Vars,
    depth: number,
    base: number,
  ): boolean {
    let current = conds;
    for (const stmt of stmts) {
      switch (stmt.type) {
        case "ReturnStatement":
          if (stmt.argument) this.visitExpr(stmt.argument, current, out, vars, depth);
          return true;
        case "IfStatement": {
          const test = this.src.slice(stmt.test);
          const thenReturns = this.walkStatements(
            [stmt.consequent],
            [...current, { kind: "if", expr: test }],
            out,
            vars,
            depth, base);
          let elseReturns = false;
          if (stmt.alternate) {
            elseReturns = this.walkStatements(
              [stmt.alternate],
              [...current, { kind: "if", expr: `!(${test})` }],
              out,
              vars,
              depth, base);
          }
          if (thenReturns && elseReturns) return true;
          if (thenReturns) current = [...current, { kind: "early-return", expr: test }];
          else if (elseReturns) current = [...current, { kind: "early-return", expr: `!(${test})` }];
          break;
        }
        case "SwitchStatement": {
          const disc = this.src.slice(stmt.discriminant);
          for (const c of stmt.cases) {
            const expr = c.test ? `${disc} === ${this.src.slice(c.test)}` : `default`;
            this.walkStatements(c.consequent, [...current, { kind: "switch-case", expr }], out, vars, depth, base);
          }
          break;
        }
        case "BlockStatement":
          if (this.walkStatements(stmt.body, current, out, vars, depth, base)) return true;
          break;
        case "TryStatement":
          if (stmt.block && this.walkStatements(stmt.block.body, current, out, vars, depth, base)) return true;
          break;
        case "VariableDeclaration":
          for (const d of stmt.declarations) {
            if (d.id?.type === "Identifier" && d.init && !isFunction(unwrap(d.init)) && containsJsx(d.init)) {
              vars.set(d.id.name, [{ expr: d.init, conds: [] }]);
            } else if (d.id?.type === "Identifier") {
              vars.delete(d.id.name);
            }
          }
          break;
        case "ExpressionStatement": {
          const e = stmt.expression;
          if (e?.type === "AssignmentExpression" && e.left?.type === "Identifier" && containsJsx(e.right)) {
            const list = vars.get(e.left.name) ?? [];
            // Conditions relative to the function root; stored so they can be re-applied on use.
            list.push({ expr: e.right, conds: current.slice(base) });
            vars.set(e.left.name, list);
          }
          break;
        }
        default:
          break;
      }
    }
    return false;
  }

  private visitExpr(e: N, conds: Condition[], out: RawJsxNode[], vars: Vars, depth: number): void {
    e = unwrap(e);
    if (!e) return;
    switch (e.type) {
      case "JSXElement":
        out.push(this.element(e, conds, vars, depth));
        return;
      case "JSXFragment": {
        const children: RawJsxNode[] = [];
        this.visitChildren(e.children, children, vars, depth);
        out.push({
          tag: "Fragment",
          native: true,
          props: [],
          conditions: conds,
          loc: this.src.loc(e.start),
          children,
        });
        return;
      }
      case "LogicalExpression": {
        const left = this.src.slice(e.left);
        if (e.operator === "&&") {
          this.visitExpr(e.right, [...conds, { kind: "and", expr: left }], out, vars, depth);
        } else {
          this.visitExpr(e.left, conds, out, vars, depth);
          this.visitExpr(e.right, [...conds, { kind: "or", expr: `!(${left})` }], out, vars, depth);
        }
        return;
      }
      case "ConditionalExpression": {
        const test = this.src.slice(e.test);
        this.visitExpr(e.consequent, [...conds, { kind: "ternary-true", expr: test }], out, vars, depth);
        this.visitExpr(e.alternate, [...conds, { kind: "ternary-false", expr: test }], out, vars, depth);
        return;
      }
      case "CallExpression": {
        const callee = unwrap(e.callee);
        if (callee?.type === "MemberExpression" && MAP_METHODS.has(callee.property?.name)) {
          const cb = unwrap(e.arguments?.[0]);
          if (isFunction(cb)) {
            const params = cb.params.map((p: N) => this.src.slice(p, 40)).join(", ");
            this.visitFnBody(
              cb,
              [...conds, { kind: "map", expr: `${this.src.slice(callee.object, 80)}.${callee.property.name}((${params}) => …)` }],
              out,
              vars,
              depth,
            );
          }
        }
        return;
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        this.visitFnBody(e, [...conds, { kind: "render-prop", expr: this.paramsText(e) }], out, vars, depth);
        return;
      case "ArrayExpression":
        for (const el of e.elements) if (el) this.visitExpr(el, conds, out, vars, depth);
        return;
      case "Identifier": {
        const entries = depth < 4 ? vars.get(e.name) : undefined;
        if (entries) for (const v of entries) this.visitExpr(v.expr, [...conds, ...v.conds], out, vars, depth + 1);
        return;
      }
      default:
        return;
    }
  }

  private paramsText(fn: N): string {
    return `(${fn.params.map((p: N) => this.src.slice(p, 40)).join(", ")}) => …`;
  }

  private visitChildren(children: N[], out: RawJsxNode[], vars: Vars, depth: number) {
    for (const c of children ?? []) {
      if (c.type === "JSXElement" || c.type === "JSXFragment") this.visitExpr(c, [], out, vars, depth);
      else if (c.type === "JSXExpressionContainer" && c.expression?.type !== "JSXEmptyExpression")
        this.visitExpr(c.expression, [], out, vars, depth);
    }
  }

  private element(el: N, conds: Condition[], vars: Vars, depth: number): RawJsxNode {
    const opening = el.openingElement;
    const tag = this.tagName(opening.name);
    const isFragment = FRAGMENTS.has(tag);
    const native = isFragment || (opening.name.type === "JSXIdentifier" && /^[a-z]/.test(tag)) || opening.name.type === "JSXNamespacedName";
    let ref: RawJsxNode["ref"];
    if (!native) {
      const dot = tag.indexOf(".");
      ref = dot === -1 ? { local: tag } : { local: tag.slice(0, dot), member: tag.slice(dot + 1) };
    }

    const props: JsxProp[] = [];
    const children: RawJsxNode[] = [];
    let fallback: string | undefined;
    for (const attr of opening.attributes) {
      if (attr.type === "JSXSpreadAttribute") {
        props.push({ name: `...${this.src.slice(attr.argument, 60)}`, isSpread: true });
        continue;
      }
      const name = attr.name.type === "JSXNamespacedName" ? `${attr.name.namespace.name}:${attr.name.name.name}` : attr.name.name;
      const v = attr.value;
      if (v == null) {
        props.push({ name, value: "true" });
        continue;
      }
      const valueNode = v.type === "JSXExpressionContainer" ? v.expression : v;
      const text = this.src.slice(valueNode, 120);
      props.push({ name, value: text });
      if (name === "fallback") fallback = text;
      if (valueNode && valueNode.type !== "JSXEmptyExpression" && containsJsx(valueNode)) {
        this.visitExpr(valueNode, [{ kind: "prop", expr: name }], children, vars, depth);
      }
    }

    const bodyChildren: RawJsxNode[] = [];
    this.visitChildren(el.children, bodyChildren, vars, depth);
    const wrapper = /(^|\.)Suspense$/.test(tag)
      ? ({ kind: "suspense", expr: fallback ?? "" } as const)
      : /ErrorBoundary$/.test(tag)
        ? ({ kind: "error-boundary", expr: tag } as const)
        : undefined;
    if (wrapper) for (const c of bodyChildren) c.conditions = [wrapper, ...c.conditions];
    children.push(...bodyChildren);

    return { tag, native, ref, props, conditions: conds, loc: this.src.loc(el.start), children };
  }

  private tagName(n: N): string {
    if (n.type === "JSXIdentifier") return n.name;
    if (n.type === "JSXMemberExpression") return `${this.tagName(n.object)}.${n.property.name}`;
    if (n.type === "JSXNamespacedName") return `${n.namespace.name}:${n.name.name}`;
    return "?";
  }
}
