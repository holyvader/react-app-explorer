import type { Edge as GraphEdge } from "@rae/schema";

/** The relation's word on its label. */
export function relationWord(e: GraphEdge): string {
  switch (e.kind) {
    case "imports":
      return e.importType === "type-only"
        ? "type import"
        : e.importType === "lazy"
          ? "lazy import"
          : e.importType === "next-dynamic"
            ? "dynamic import"
            : e.importType === "dynamic"
              ? "import()"
              : e.importType === "reexport"
                ? "re-exports"
                : "imports";
    case "renders":
      return "renders";
    case "usesHook":
      return "uses hook";
    case "invokes":
      return "invokes";
    case "invokesAction":
      return "server action";
    case "declares":
      return "declares";
  }
}
