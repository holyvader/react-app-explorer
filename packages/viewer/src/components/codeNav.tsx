import { ActionIconButton, Button, HStack, Text } from "@rae/design-system";
import { IconBack, IconForward, IconFocus } from "@rae/design-system/icons";
import type { NodeId } from "@rae/schema";
import { useContext } from "react";
import { CodeNavContext } from "./codeNavContext.ts";
import { displayName } from "../lib/displayName.ts";
import { KIND_META } from "../lib/kinds.tsx";
import type { Tok } from "../lib/syntax.ts";
import { useExplorer } from "../store.ts";

/*
 * Moving through code: the code view and the code diff share a history (store `codeView`). A name
 * in the code that refers to another element is a link: it opens that element's code (its diff, when
 * looking at a diff and it changed) in the same dialog. Back / Forward walk the history.
 */


/** Token kinds that may be a name referring to another element. */
const NAMES = new Set<Tok["k"]>(["type", "fn", "plain", "tag", "name"]);

/** One token of code: a link when it names another element (not a property: `x.name`). */
export function CodeToken({ tok, prev }: { tok: Tok; prev?: Tok }) {
  const nav = useContext(CodeNavContext);
  const id = nav && NAMES.has(tok.k) && prev?.t !== "." ? nav.links.get(tok.t) : undefined;
  if (!id || !nav) return <span className={`rae-tok--${tok.k}`}>{tok.t}</span>;
  const n = nav.snapshot.nodes[id];
  const what = n ? `${displayName(n)} (${KIND_META[n.kind].label.toLowerCase()}, ${n.filePath})` : id;
  return (
    <button type="button" className={`rae-tok--${tok.k} rae-code-view__link`} title={`Open ${what}`} onClick={() => useExplorer.getState().codeGo(id)}>
      {tok.t}
    </button>
  );
}

/** Back, Forward, and putting the element shown on the diagram. */
export function CodeNavBar({ id }: { id: NodeId }) {
  const view = useExplorer((s) => s.codeView);
  const { codeStep, showCode, addNodes } = useExplorer.getState();
  if (!view) return null;
  const canBack = view.at > 0;
  const canForward = view.at < view.stack.length - 1;
  return (
    <HStack gap="1">
      <ActionIconButton label="Back" icon={<IconBack />} size="xs" variant="outline" disabled={!canBack} onClick={() => codeStep(-1)} />
      <ActionIconButton label="Forward" icon={<IconForward />} size="xs" variant="outline" disabled={!canForward} onClick={() => codeStep(1)} />
      {view.stack.length > 1 && (
        <Text fontSize="xs" color="fg.subtle" fontFamily="mono" px="1">
          {view.at + 1} / {view.stack.length}
        </Text>
      )}
      <Button
        size="xs"
        variant="outline"
        rounded="l2"
        gap="1.5"
        onClick={() => {
          showCode(undefined);
          addNodes([id], { select: id, focus: id });
        }}
      >
        <IconFocus size={13} /> Show on diagram
      </Button>
    </HStack>
  );
}
