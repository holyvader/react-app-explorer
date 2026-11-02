import type { ImportType, ParamDef, PropDef, TypeParam } from "@rae/schema";
import { parseSync } from "oxc-parser";
import { JsxAnalyzer } from "./jsx.ts";
import type {
  DeclExtract,
  DeclKind,
  ExportRecord,
  FileExtract,
  ImportName,
  ImportRecord,
  RawFn,
  RawHook,
  RawRef,
  Resolved,
} from "./types.ts";
import { containsJsx, HOOK_RE, isFunction, memberName, type N, SourceText, unwrap, walk } from "./util.ts";

export type ResolveFn = (fromFile: string, specifier: string) => Resolved;

const WRAPPERS = /^(memo|forwardRef|observer|styled|withRouter|connect)$/;
const COMPONENT_BASES = /^(React\.)?(Component|PureComponent)$/;

function langOf(path: string): "ts" | "tsx" | "jsx" {
  if (path.endsWith(".tsx")) return "tsx";
  if (/\.[mc]?ts$/.test(path)) return "ts";
  return "jsx";
}

interface Candidate {
  local: string;
  fn?: N; // function node
  cls?: N; // class node
  nameNode?: N;
  wrapped: boolean;
}

interface TypeMember {
  name: string;
  type?: string;
  optional: boolean;
}

export function extractFile(absPath: string, text: string, stamp: string, resolve: ResolveFn): FileExtract {
  const src = new SourceText(text);
  const result = parseSync(absPath, text, { lang: langOf(absPath), preserveParens: false });
  const program = result.program as N;
  const errors = result.errors.slice(0, 5).map((e) => e.message);

  const out: FileExtract = {
    absPath,
    stamp,
    directives: [],
    serverOnly: false,
    clientOnly: false,
    imports: [],
    exports: [],
    decls: [],
    aliases: {},
    errors,
  };

  // ---- directives -------------------------------------------------------------------------
  for (const stmt of program.body) {
    if (stmt.type === "ExpressionStatement" && typeof stmt.directive === "string") out.directives.push(stmt.directive);
    else break;
  }
  const fileUseServer = out.directives.includes("use server");

  // ---- imports / exports ------------------------------------------------------------------
  const importIndex = new Map<string, number>();
  const addImport = (specifier: string, type: ImportType, names: ImportName[]): number => {
    const key = `${type}\0${specifier}`;
    let idx = importIndex.get(key);
    if (idx === undefined) {
      idx = out.imports.length;
      out.imports.push({ specifier, type, names: [] });
      importIndex.set(key, idx);
    }
    out.imports[idx]!.names.push(...names);
    return idx;
  };

  const types = new Map<string, TypeMember[]>();
  const candidates: Candidate[] = [];

  /**
   * Names of the types referred to inside some type positions: `Foo`, `Foo<Bar>`, `ns.Foo` (→ `ns`),
   * `typeof x`, `interface A extends B`. Generic parameters (`T`) and the declaration itself are left out.
   */
  const typeRefsIn = (roots: N[], self?: string): string[] => {
    const found = new Set<string>();
    const params = new Set<string>();
    const leftmost = (n: N): string | undefined => (n?.type === "Identifier" ? n.name : n?.type === "TSQualifiedName" || n?.type === "MemberExpression" ? leftmost(n.left ?? n.object) : undefined);
    // roots may hold arrays (`extends`, params): walk() only takes single nodes
    for (const root of roots.flat()) {
      walk(root, (n) => {
        if (n.type === "TSTypeParameter" && n.name) params.add(typeof n.name === "string" ? n.name : n.name.name);
        else if (n.type === "TSTypeReference") {
          const name = leftmost(n.typeName);
          if (name) found.add(name);
        } else if (n.type === "TSTypeQuery") {
          const name = leftmost(n.exprName);
          if (name) found.add(name);
        } else if (n.type === "TSInterfaceHeritage" || n.type === "TSClassImplements") {
          const name = leftmost(n.expression);
          if (name) found.add(name);
        }
      });
    }
    for (const p of params) found.delete(p);
    if (self) found.delete(self);
    return [...found];
  };

  /** `<T extends Item = Item, K>` → [{ name: "T", constraint: "Item", default: "Item" }, { name: "K" }]. */
  const typeParamsOf = (tp: N): TypeParam[] | undefined => {
    const params = (tp?.params ?? []).map((p: N) => ({
      name: typeof p.name === "string" ? p.name : p.name?.name,
      constraint: p.constraint ? src.slice(p.constraint, 300) : undefined,
      default: p.default ? src.slice(p.default, 300) : undefined,
    }));
    return params.length ? params : undefined;
  };

  const declNames = (decl: N): string[] => {
    if (!decl) return [];
    if (decl.id?.type === "Identifier") return [decl.id.name];
    if (decl.type === "VariableDeclaration") {
      return decl.declarations.flatMap((d: N) => (d.id?.type === "Identifier" ? [d.id.name] : []));
    }
    return [];
  };

  for (const stmt of program.body) {
    switch (stmt.type) {
      case "ImportDeclaration": {
        const spec = stmt.source.value as string;
        if (spec === "server-only") out.serverOnly = true;
        if (spec === "client-only") out.clientOnly = true;
        const names: ImportName[] = [];
        let allTypes = stmt.importKind === "type";
        let anyValue = false;
        for (const s of stmt.specifiers ?? []) {
          if (s.type === "ImportDefaultSpecifier") names.push({ imported: "default", local: s.local.name });
          else if (s.type === "ImportNamespaceSpecifier") names.push({ imported: "*", local: s.local.name });
          else names.push({ imported: memberName(s.imported) ?? s.local.name, local: s.local.name });
          if (s.importKind !== "type" && stmt.importKind !== "type") anyValue = true;
        }
        if (stmt.specifiers?.length && !anyValue) allTypes = true;
        addImport(spec, allTypes ? "type-only" : "static", names);
        break;
      }
      case "ExportAllDeclaration": {
        const idx = addImport(stmt.source.value, "reexport", []);
        out.exports.push({ exported: stmt.exported ? memberName(stmt.exported)! : "*", from: idx, imported: "*" });
        break;
      }
      case "ExportNamedDeclaration": {
        if (stmt.source) {
          const typeOnly = stmt.exportKind === "type";
          const idx = addImport(stmt.source.value, typeOnly ? "type-only" : "reexport", []);
          for (const s of stmt.specifiers) {
            out.exports.push({ exported: memberName(s.exported)!, from: idx, imported: memberName(s.local)! });
          }
        } else if (stmt.declaration) {
          for (const name of declNames(stmt.declaration)) out.exports.push({ exported: name, local: name });
          collectDecl(stmt.declaration);
        } else {
          for (const s of stmt.specifiers) {
            out.exports.push({ exported: memberName(s.exported)!, local: memberName(s.local)! });
          }
        }
        break;
      }
      case "ExportDefaultDeclaration": {
        const d = stmt.declaration;
        const inner = unwrap(d);
        if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) {
          out.exports.push({ exported: "default", local: d.id.name });
          collectDecl(d);
        } else if (isFunction(inner) || inner?.type === "ClassDeclaration" || inner?.type === "ClassExpression") {
          out.exports.push({ exported: "default", local: "default" });
          if (isFunction(inner)) candidates.push({ local: "default", fn: inner, wrapped: false });
          else candidates.push({ local: "default", cls: inner, wrapped: false });
        } else if (inner?.type === "Identifier") {
          out.exports.push({ exported: "default", local: inner.name });
        } else if (inner?.type === "CallExpression") {
          const wrapped = unwrapWrapperCall(inner);
          if (wrapped?.type === "Identifier") {
            out.exports.push({ exported: "default", local: wrapped.name });
          } else if (isFunction(wrapped)) {
            const local = wrapped.id?.name ?? "default";
            out.exports.push({ exported: "default", local });
            candidates.push({ local, fn: wrapped, wrapped: true });
          }
        }
        break;
      }
      default:
        collectDecl(stmt);
    }
  }

  function unwrapWrapperCall(call: N): N | undefined {
    let cur = call;
    while (cur?.type === "CallExpression") {
      const callee = unwrap(cur.callee);
      const name = callee?.type === "MemberExpression" ? callee.property?.name : callee?.name;
      if (!name || !WRAPPERS.test(name)) return undefined;
      cur = unwrap(cur.arguments?.[0]);
      // connect(mapState)(Component) → callee is itself a call; handled by loop on callee below
    }
    return cur;
  }

  function collectDecl(decl: N) {
    if (!decl) return;
    switch (decl.type) {
      case "FunctionDeclaration":
        if (decl.id) candidates.push({ local: decl.id.name, fn: decl, nameNode: decl.id, wrapped: false });
        break;
      case "ClassDeclaration":
        if (decl.id) candidates.push({ local: decl.id.name, cls: decl, nameNode: decl.id, wrapped: false });
        break;
      case "VariableDeclaration":
        for (const d of decl.declarations) {
          if (d.id?.type !== "Identifier" || !d.init) continue;
          const init = unwrap(d.init);
          if (isFunction(init)) {
            candidates.push({ local: d.id.name, fn: init, nameNode: d.id, wrapped: false });
          } else if (init?.type === "ClassExpression") {
            candidates.push({ local: d.id.name, cls: init, nameNode: d.id, wrapped: false });
          } else if (init?.type === "CallExpression") {
            const wrapped = unwrapWrapperCall(init);
            if (wrapped?.type === "Identifier") out.aliases[d.id.name] = wrapped.name;
            else if (isFunction(wrapped)) candidates.push({ local: d.id.name, fn: wrapped, nameNode: d.id, wrapped: true });
          }
        }
        break;
      case "TSInterfaceDeclaration":
        types.set(decl.id.name, typeMembers(decl.body?.body ?? []));
        typeDecl(decl, "interface");
        break;
      case "TSTypeAliasDeclaration":
        if (decl.typeAnnotation?.type === "TSTypeLiteral") types.set(decl.id.name, typeMembers(decl.typeAnnotation.members));
        typeDecl(decl, "type");
        break;
      case "TSEnumDeclaration":
        typeDecl(decl, "enum");
        break;
      default:
        break;
    }
  }

  /** A type declaration becomes a declaration of kind "type": its text is the preview, its refs link to other types. */
  function typeDecl(decl: N, typeKind: "interface" | "type" | "enum") {
    if (!decl.id?.name) return;
    out.decls.push({
      local: decl.id.name,
      kind: "type",
      isAsync: false,
      loc: src.loc(decl.id.start),
      pos: decl.id.start,
      params: [],
      hooks: [],
      functions: [],
      calls: [],
      renders: [],
      renderTree: [],
      directives: [],
      typeText: src.raw(decl),
      typeKind,
      typeRefs: typeRefsIn([decl.typeAnnotation, decl.body, decl.extends, decl.typeParameters], decl.id.name),
      typeParams: typeParamsOf(decl.typeParameters),
      extends: decl.extends?.length ? decl.extends.map((h: N) => src.slice(h, 300)) : undefined,
    });
  }

  function typeMembers(members: N[]): TypeMember[] {
    const res: TypeMember[] = [];
    for (const m of members) {
      if (m.type !== "TSPropertySignature" && m.type !== "TSMethodSignature") continue;
      const name = memberName(m.key);
      if (!name) continue;
      res.push({
        name,
        type: m.typeAnnotation ? src.slice(m.typeAnnotation.typeAnnotation, 120) : m.type === "TSMethodSignature" ? src.slice(m, 120) : undefined,
        optional: !!m.optional,
      });
    }
    return res;
  }

  // ---- dynamic / lazy imports (anywhere in the file) --------------------------------------
  walk(program, (n, anc) => {
    if (n.type !== "ImportExpression") return;
    const srcNode = n.source;
    if (srcNode?.type !== "Literal" || typeof srcNode.value !== "string") return;
    // Find enclosing call: lazy(() => import()) / dynamic(() => import())
    let type: ImportType = "dynamic";
    let bindTo: string | undefined;
    for (let i = anc.length - 1; i >= 0; i--) {
      const a = anc[i];
      if (a.type === "CallExpression" && a !== n) {
        const callee = unwrap(a.callee);
        const name = callee?.type === "MemberExpression" ? callee.property?.name : callee?.name;
        if (name === "lazy") type = "lazy";
        else if (name === "dynamic" || name === "loadable") type = "next-dynamic";
        else continue;
        const decl = anc[i - 1];
        if (decl?.type === "VariableDeclarator" && decl.id?.type === "Identifier") bindTo = decl.id.name;
        break;
      }
      if (isFunction(a) && !(anc[i - 1]?.type === "CallExpression")) break;
    }
    addImport(srcNode.value, type, bindTo ? [{ imported: "default", local: bindTo }] : []);
    return false;
  });

  // ---- analyze decl candidates ------------------------------------------------------------
  const jsx = new JsxAnalyzer(src);
  for (const c of candidates) {
    const decl = analyzeCandidate(c);
    if (decl) out.decls.push(decl);
  }

  function analyzeCandidate(c: Candidate): DeclExtract | undefined {
    const node = c.fn ?? c.cls;
    const directives: string[] = [];
    if (c.fn?.body?.type === "BlockStatement") {
      for (const s of c.fn.body.body) {
        if (s.type === "ExpressionStatement" && typeof s.directive === "string") directives.push(s.directive);
        else break;
      }
    }
    const isAsync = !!c.fn?.async;
    let kind: DeclKind;
    let tree: DeclExtract["renderTree"] = [];
    let renders: RawRef[] = [];

    const isClassComponent = c.cls && COMPONENT_BASES.test(src.slice(c.cls.superClass ?? null));
    if (directives.includes("use server") || (fileUseServer && isAsync)) kind = "serverAction";
    else if (HOOK_RE.test(c.local)) kind = "hook";
    else if (isClassComponent || (c.fn && (c.wrapped || containsJsx(c.fn.body)) && /^[A-Z]|^default$/.test(c.local))) kind = "component";
    else if (c.fn && containsJsx(c.fn.body)) kind = "component";
    else kind = "function";

    if (kind === "component") {
      const r = c.cls ? jsx.analyzeClass(c.cls) : jsx.analyzeFunction(c.fn);
      tree = r.tree;
      renders = r.renders;
    }

    const params: ParamDef[] = c.fn ? c.fn.params.map(paramDef) : [];
    const decl: DeclExtract = {
      local: c.local,
      kind,
      isAsync,
      loc: src.loc((c.nameNode ?? node).start),
      pos: (c.nameNode ?? node).start,
      params,
      returnType: c.fn?.returnType ? src.slice(c.fn.returnType.typeAnnotation, 160) : undefined,
      hooks: [],
      functions: [],
      calls: [],
      renders,
      renderTree: tree,
      directives,
    };
    if (kind === "component" && c.fn?.params[0]) decl.props = propsOf(c.fn.params[0]);
    if (c.fn) {
      const refs = typeRefsIn([...c.fn.params, c.fn.returnType, c.fn.typeParameters]);
      if (refs.length) decl.typeRefs = refs;
      decl.typeParams = typeParamsOf(c.fn.typeParameters);
    }

    const body = c.fn ? c.fn.body : c.cls?.body;
    collectBody(body, decl);
    if (c.cls) decl.functions = classMethods(c.cls);
    return decl;
  }

  function paramDef(p: N): ParamDef {
    let def: string | undefined;
    if (p.type === "AssignmentPattern") {
      def = src.slice(p.right, 60);
      p = p.left;
    }
    const type = p.typeAnnotation ? src.slice(p.typeAnnotation.typeAnnotation, 160) : undefined;
    let name: string;
    if (p.type === "Identifier") name = p.name;
    else if (p.type === "RestElement") name = `...${src.slice(p.argument, 40)}`;
    else if (p.type === "ObjectPattern" || p.type === "ArrayPattern") {
      // slice without the type annotation
      const end = p.typeAnnotation ? p.typeAnnotation.start : p.end;
      name = src.slice({ start: p.start, end }, 80).replace(/:\s*$/, "");
    } else name = src.slice(p, 40);
    return { name, type, optional: !!p.optional || def !== undefined, default: def };
  }

  function propsOf(param: N): PropDef[] | undefined {
    let p = param;
    if (p.type === "AssignmentPattern") p = p.left;
    const members = new Map<string, PropDef>();
    const ann = p.typeAnnotation?.typeAnnotation;
    const fromType = (t: N) => {
      if (!t) return;
      if (t.type === "TSTypeLiteral") for (const m of typeMembers(t.members)) members.set(m.name, { ...m });
      else if (t.type === "TSTypeReference" && t.typeName?.type === "Identifier") {
        const local = types.get(t.typeName.name);
        if (local) for (const m of local) members.set(m.name, { ...m });
      } else if (t.type === "TSIntersectionType") t.types.forEach(fromType);
    };
    fromType(ann);
    if (p.type === "ObjectPattern") {
      for (const prop of p.properties) {
        if (prop.type === "RestElement") {
          members.set(`...${src.slice(prop.argument, 40)}`, { name: `...${src.slice(prop.argument, 40)}`, optional: true });
          continue;
        }
        const name = memberName(prop.key);
        if (!name) continue;
        const existing = members.get(name) ?? { name, optional: false };
        if (prop.value?.type === "AssignmentPattern") {
          existing.default = src.slice(prop.value.right, 60);
          existing.optional = true;
        }
        members.set(name, existing);
      }
    }
    return members.size ? [...members.values()] : undefined;
  }

  function classMethods(cls: N): RawFn[] {
    const fns: RawFn[] = [];
    for (const m of cls.body?.body ?? []) {
      const fn = m.type === "MethodDefinition" ? m.value : m.type === "PropertyDefinition" && isFunction(m.value) ? m.value : undefined;
      if (!fn) continue;
      const name = memberName(m.key) ?? "?";
      if (name === "render") continue;
      fns.push({
        name,
        isAsync: !!fn.async,
        params: fn.params.map(paramDef),
        returnType: fn.returnType ? src.slice(fn.returnType.typeAnnotation, 160) : undefined,
        loc: src.loc(m.key.start),
        pos: m.key.start,
      });
    }
    return fns;
  }

  function collectBody(body: N, decl: DeclExtract) {
    if (!body) return;
    const seenCalls = new Set<string>();
    // Inner functions: top-level statements of the body.
    if (body.type === "BlockStatement") {
      for (const s of body.body) {
        if (s.type === "FunctionDeclaration" && s.id) decl.functions.push(innerFn(s.id.name, s, s.id));
        else if (s.type === "VariableDeclaration") {
          for (const d of s.declarations) {
            if (d.id?.type !== "Identifier" || !d.init) continue;
            const init = unwrap(d.init);
            if (isFunction(init)) decl.functions.push(innerFn(d.id.name, init, d.id));
            else if (init?.type === "CallExpression" && /^(useCallback|useMemo|useEvent|useEffectEvent)$/.test(calleeName(init) ?? "")) {
              const fn = unwrap(init.arguments?.[0]);
              if (isFunction(fn) && calleeName(init) !== "useMemo") decl.functions.push(innerFn(d.id.name, fn, d.id));
            }
          }
        }
      }
    }

    walk(body, (n, anc) => {
      if (n.type === "NewExpression") {
        // new Foo() invokes the Foo declaration.
        const callee = unwrap(n.callee);
        if (callee?.type === "Identifier" && !seenCalls.has(`${callee.name}.`)) {
          seenCalls.add(`${callee.name}.`);
          decl.calls.push({ local: callee.name });
        }
      } else if (n.type === "CallExpression") {
        const callee = unwrap(n.callee);
        let local: string | undefined;
        let member: string | undefined;
        if (callee?.type === "Identifier") local = callee.name;
        else if (callee?.type === "MemberExpression" && unwrap(callee.object)?.type === "Identifier" && !callee.computed) {
          local = unwrap(callee.object).name;
          member = callee.property.name;
        }
        if (!local) return;
        const fnName = member ?? local;
        if (HOOK_RE.test(fnName)) {
          decl.hooks.push(hookUsage(n, local, member, anc));
        } else {
          const key = `${local}.${member ?? ""}`;
          if (!seenCalls.has(key)) {
            seenCalls.add(key);
            decl.calls.push({ local, member });
          }
        }
      } else if (n.type === "JSXAttribute" && n.value?.type === "JSXExpressionContainer") {
        // <form action={addTodo}> / onClick={handler} — direct references count as calls.
        const e = unwrap(n.value.expression);
        if (e?.type === "Identifier" && !seenCalls.has(`${e.name}.`)) {
          seenCalls.add(`${e.name}.`);
          decl.calls.push({ local: e.name });
        }
      }
    });
  }

  /** Calls / `new` made by module-level code (not inside functions, which are declarations or callbacks). */
  function moduleInvocations(stmts: N[]): RawRef[] {
    const refs: RawRef[] = [];
    const seen = new Set<string>();
    for (const stmt of stmts) {
      walk(stmt, (n) => {
        if (isFunction(n) || n.type === "ClassExpression") return false;
        if (n.type !== "CallExpression" && n.type !== "NewExpression") return;
        const callee = unwrap(n.callee);
        let local: string | undefined;
        let member: string | undefined;
        if (callee?.type === "Identifier") local = callee.name;
        else if (callee?.type === "MemberExpression" && unwrap(callee.object)?.type === "Identifier" && !callee.computed) {
          local = unwrap(callee.object).name;
          member = callee.property.name;
        }
        if (!local || HOOK_RE.test(member ?? local)) return;
        const key = `${local}.${member ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        refs.push({ local, member });
      });
    }
    return refs;
  }

  function calleeName(call: N): string | undefined {
    const c = unwrap(call.callee);
    return c?.type === "Identifier" ? c.name : c?.type === "MemberExpression" ? c.property?.name : undefined;
  }

  function innerFn(name: string, fn: N, nameNode: N): RawFn {
    return {
      name,
      isAsync: !!fn.async,
      params: fn.params.map(paramDef),
      returnType: fn.returnType ? src.slice(fn.returnType.typeAnnotation, 160) : undefined,
      loc: src.loc(nameNode.start),
      pos: nameNode.start,
    };
  }

  function hookUsage(call: N, local: string, member: string | undefined, anc: N[]): RawHook {
    let assignedTo: string | undefined;
    const bindingPositions: number[] = [];
    const bindingNames: string[] = [];
    let arrayPattern = false;
    let i = anc.length - 1;
    while (i >= 0 && (anc[i].type === "AwaitExpression" || anc[i].type === "TSAsExpression" || anc[i].type === "TSNonNullExpression")) i--;
    const parent = anc[i];
    if (parent?.type === "VariableDeclarator" && parent.id) {
      assignedTo = src.slice(parent.id, 80);
      const id = parent.id;
      if (id.type === "Identifier") {
        bindingPositions.push(id.start);
        bindingNames.push(id.name);
      }
      else {
        arrayPattern = id.type === "ArrayPattern";
        walk(id, (b, a) => {
          // Only binding identifiers (values), not object keys.
          const p = a[a.length - 1];
          if (p?.type === "AssignmentPattern" && p.right === b) return false;
          if (b.type === "Identifier" && !(p?.type === "Property" && p.key === b)) {
            bindingPositions.push(b.start);
            bindingNames.push(b.name);
          }
          if (b.type === "TSTypeAnnotation") return false;
        });
      }
    }
    return {
      hook: member ? `${local}.${member}` : local,
      local,
      member,
      args: (call.arguments ?? []).map((a: N) => src.slice(a, 80)),
      assignedTo,
      loc: src.loc(call.start),
      bindingPositions,
      bindingNames,
      arrayPattern,
      calleePos: unwrap(call.callee).type === "MemberExpression" ? unwrap(call.callee).property.start : unwrap(call.callee).start,
    };
  }

  // ---- module-level JSX ------------------------------------------------------------------
  const loose = program.body.filter(
    (s: N) =>
      s.type === "ExpressionStatement" ||
      (s.type === "VariableDeclaration" && s.declarations.some((d: N) => d.init && !isFunction(unwrap(d.init)))),
  );
  if (loose.length || program.body.some((s: N) => s.type === "ExportDefaultDeclaration" || s.type === "ExportNamedDeclaration")) {
    const exported = program.body.flatMap((s: N) => {
      if (s.type === "ExportDefaultDeclaration") return isFunction(unwrap(s.declaration)) || s.declaration?.type === "ClassDeclaration" ? [] : [s.declaration];
      // export const store = createStore();  (function-valued exports are declarations, skipped by the walker)
      if (s.type === "ExportNamedDeclaration" && s.declaration?.type === "VariableDeclaration") return [s.declaration];
      return [];
    });
    out.moduleCalls = moduleInvocations([...loose, ...exported]);
    if (!out.moduleCalls.length) delete out.moduleCalls;
  }
  if (loose.length) {
    const r = jsx.analyzeLoose(loose);
    if (r.tree.length) {
      out.moduleTree = r.tree;
      out.moduleRenders = r.renders;
    }
  }

  // ---- resolve imports ----------------------------------------------------------------------
  for (const imp of out.imports) imp.resolved = resolve(absPath, imp.specifier);

  return out;
}

export type { FileExtract, ImportRecord, ExportRecord };
