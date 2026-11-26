import { createLucideIcon, type LucideIconNode } from "lucide-react";

/**
 * Icons Lucide doesn't have, drawn on its 24px grid with its stroke (2px, round caps and joins),
 * so they size, colour and behave like the rest. Each one: an icon object for `createLucideIcon`.
 */

// The component tag "</>", smaller and lifted to the top half: the start of the render icons.
const TAG: LucideIconNode[] = [
  ["path", { d: "m7 3-4 3.5 4 3.5", key: "tag-l" }],
  ["path", { d: "m17 3 4 3.5-4 3.5", key: "tag-r" }],
  ["path", { d: "m13.5 2-3 9", key: "tag-s" }],
];

/** A component's renders, one level: "</>" with an arrow down (mirrors IconRenderedBy). */
export const IconRenders = createLucideIcon({
  name: "renders",
  node: [...TAG, ["path", { d: "M12 14v8", key: "arrow" }], ["path", { d: "m8.5 18.5 3.5 3.5 3.5-3.5", key: "head" }]],
});

/** What renders a component, one level: an arrow up above "</>" (the Renders icon, upside down). */
export const IconRenderedBy = createLucideIcon({
  name: "rendered-by",
  node: [
    ["path", { d: "M12 2v8", key: "arrow" }],
    ["path", { d: "m8.5 5.5 3.5-3.5 3.5 3.5", key: "head" }],
    ["path", { d: "m7 14-4 3.5 4 3.5", key: "tag-l" }],
    ["path", { d: "m17 14 4 3.5-4 3.5", key: "tag-r" }],
    ["path", { d: "m13.5 13-3 9", key: "tag-s" }],
  ],
});

/** A component's whole render tree: "</>" with a double chevron down (mirrors "up to the root"). */
export const IconRenderTree = createLucideIcon({
  name: "render-tree",
  node: [...TAG, ["path", { d: "m8 14 4 3.5 4-3.5", key: "c1" }], ["path", { d: "m8 19 4 3.5 4-3.5", key: "c2" }]],
});
