import { ActionIconButton, Box, chakra, Flex, Link, Text, textPx } from "@rae/design-system";
import { IconChevronDown, IconOpen, IconPlay, IconRestart, IconStop } from "@rae/design-system/icons";
import { useEffect, useLayoutEffect, useRef } from "react";
import { portOf, type RunView, runWords, useScripts } from "../../lib/scripts.ts";
import "./scripts.css";

/*
 * The Scripts console: a sheet rising from the canvas's status bar, over the diagram. The folder's
 * package.json scripts on the left (state, run / stop), the chosen one's output on the right. Opened
 * from the status bar's Scripts button or a run's chip, or by running a script from ⌘K (`>`).
 */


/** A run's state as a mark: a green dot (running), ✓ or ✕. */
export function RunMark({ run }: { run?: RunView }) {
  if (!run) return <Box as="span" w="7px" flexShrink={0} />;
  const s = run.summary.status;
  if (s === "running") return <Box as="span" w="7px" h="7px" rounded="full" flexShrink={0} bg="diff.added.solid" title="running" />;
  if (s === "stopped")
    return (
      <Text as="span" fontFamily="mono" fontSize="11px" flexShrink={0} color="fg.subtle" title="stopped">
        ■
      </Text>
    );
  return (
    <Text as="span" fontFamily="mono" fontSize="11px" flexShrink={0} color={s === "exited" ? "diff.added.fg" : "diff.removed.fg"} title={s === "exited" ? "done" : "failed"}>
      {s === "exited" ? "✓" : "✕"}
    </Text>
  );
}

export function ScriptsConsole() {
  const { open, info, error, runs, selected } = useScripts();
  const { run, stop, restart, show, close } = useScripts.getState();
  const sheet = useRef<HTMLElement>(null);

  // Esc closes it (when focus is in it)
  useEffect(() => {
    if (open) sheet.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  const names = Object.keys(info?.scripts ?? {});
  const current = selected && info?.scripts[selected] !== undefined ? selected : names[0];
  const view = current ? runs[current] : undefined;
  const running = view?.summary.status === "running";

  return (
    <chakra.section
      ref={sheet}
      tabIndex={-1}
      aria-label="Scripts"
      className="rae-scripts"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <nav className="rae-scripts__list" aria-label="package.json scripts">
        <Flex align="center" justify="space-between" px="3" pt="1" pb="2">
          <Text textStyle="panelLabel" color="fg.subtle">
            Scripts
          </Text>
          {info && (
            <Text fontFamily="mono" fontSize={textPx(11)} color="fg.subtle" title={`${info.dir}/package.json`}>
              {info.manager}
            </Text>
          )}
        </Flex>
        {error && (
          <Text px="3" fontSize={textPx(12)} color="fg.muted">
            {error}
          </Text>
        )}
        {info && !names.length && (
          <Text px="3" fontSize={textPx(12)} color="fg.muted">
            This package.json has no scripts.
          </Text>
        )}
        {names.map((name) => {
          const r = runs[name];
          const on = name === current;
          return (
            <div key={name} className="rae-scripts__row" data-on={on || undefined}>
              <button type="button" className="rae-scripts__pick" aria-current={on || undefined} title={info!.scripts[name]} onClick={() => show(name)}>
                <RunMark run={r} />
                <span className="rae-scripts__name">{name}</span>
                {r?.summary.status === "running" && r.summary.url && <span className="rae-scripts__port">{portOf(r.summary.url)}</span>}
              </button>
              {r?.summary.status === "running" ? (
                <ActionIconButton size="2xs" label={`Stop ${name}`} icon={<IconStop />} onClick={() => void stop(name)} />
              ) : (
                <ActionIconButton size="2xs" label={`Run ${name}`} icon={<IconPlay />} onClick={() => void run(name)} />
              )}
            </div>
          );
        })}
      </nav>
      <Flex direction="column" flex="1" minW="0">
        <Flex align="center" gap="2" h="40px" pl="3.5" pr="2" borderBottomWidth="1px" borderColor="border" flexShrink={0}>
          {current ? (
            <>
              <Text fontWeight="semibold" fontSize={textPx(13)}>
                {current}
              </Text>
              <Text fontFamily="mono" fontSize={textPx(11.5)} color="fg.subtle" truncate minW="0" title={info?.scripts[current]}>
                {info?.scripts[current]}
              </Text>
              {view && (
                <Text fontFamily="mono" fontSize={textPx(11.5)} color={view.summary.status === "failed" ? "diff.removed.fg" : "fg.muted"} flexShrink={0}>
                  · {runWords(view.summary)}
                </Text>
              )}
            </>
          ) : (
            <Text fontSize={textPx(13)} color="fg.muted">
              No script chosen
            </Text>
          )}
          <Box flex="1" />
          {running && view?.summary.url && (
            <Link href={view.summary.url} target="_blank" rel="noreferrer" fontSize={textPx(12)} color="fg.muted" display="inline-flex" alignItems="center" gap="1" flexShrink={0}>
              {view.summary.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} <IconOpen size={12} />
            </Link>
          )}
          {current &&
            (running ? (
              <>
                <ActionIconButton size="xs" label={`Restart ${current}`} icon={<IconRestart />} onClick={() => void restart(current)} />
                <ActionIconButton size="xs" label={`Stop ${current}`} icon={<IconStop />} onClick={() => void stop(current)} />
              </>
            ) : (
              <ActionIconButton size="xs" label={`${view ? "Run again" : "Run"}: ${current}`} icon={view ? <IconRestart /> : <IconPlay />} onClick={() => void run(current)} />
            ))}
          <ActionIconButton size="xs" label="Close the console (Esc)" icon={<IconChevronDown />} onClick={close} />
        </Flex>
        <RunLog view={view} script={current} />
      </Flex>
    </chakra.section>
  );
}

/** The output, following the end unless scrolled up. */
function RunLog({ view, script }: { view?: RunView; script?: string }) {
  const box = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  const log = view?.log ?? "";
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [log, script]);
  return (
    <pre
      ref={box}
      className="rae-scripts__log"
      aria-live="off"
      onScroll={(e) => {
        const el = e.currentTarget;
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {view ? log || "…" : script ? `Not run yet. Press ▶ to run "${script}".` : ""}
    </pre>
  );
}
