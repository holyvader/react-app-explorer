import { Text, textPx } from "@rae/design-system";
import { IconPlay } from "@rae/design-system/icons";
import type { KeyboardEvent } from "react";
import { matchingScripts, runWords, useScripts } from "../../lib/scripts.ts";
import { RunMark } from "./ScriptsConsole.tsx";


/**
 * ⌘K with `>`: the scripts to run, filtered by what follows. Enter (in the box: the first) or a
 * click runs one, and the Scripts console opens on it. ↑ / ↓ move between them.
 */
export function ScriptCommands({ term, onRun }: { term: string; onRun: () => void }) {
  const { info, error, runs } = useScripts();
  if (error) return <div className="rae-tree__empty">{error}</div>;
  if (!info) return <div className="rae-tree__empty">Reading package.json…</div>;
  const names = matchingScripts(term, info.scripts);
  const run = (name: string) => {
    void useScripts.getState().run(name);
    onRun();
  };
  const move = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const all = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = all.indexOf(e.currentTarget) + step;
    if (at < 0) e.currentTarget.closest(".rae-tree")?.previousElementSibling?.querySelector("input")?.focus();
    else all[at]?.focus();
  };
  return (
    <>
      <Text px="3" pt="2" pb="1" textStyle="panelLabel" color="fg.subtle">
        Run a script · {info.manager}
      </Text>
      {!names.length && <div className="rae-tree__empty">{Object.keys(info.scripts).length ? "No script matches." : "This package.json has no scripts."}</div>}
      {names.map((name, i) => {
        const r = runs[name];
        return (
          <button key={name} type="button" className="rae-tree__row rae-script-command" tabIndex={i === 0 ? 0 : -1} onClick={() => run(name)} onKeyDown={move} title={info.scripts[name]}>
            <IconPlay size={12} />
            <span className="rae-tree__name">{name}</span>
            <Text as="span" fontFamily="mono" fontSize={textPx(11.5)} color="fg.subtle" truncate flex="1" minW="0">
              {info.scripts[name]}
            </Text>
            {r && (
              <Text as="span" display="inline-flex" alignItems="center" gap="1.5" fontSize={textPx(11.5)} color="fg.muted" flexShrink={0}>
                <RunMark run={r} /> {runWords(r.summary)}
              </Text>
            )}
          </button>
        );
      })}
    </>
  );
}
