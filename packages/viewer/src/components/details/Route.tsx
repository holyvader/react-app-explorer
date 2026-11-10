import type { GraphNode } from "@rae/schema";
import { Box, CodeToken, Eyebrow, Flex, Stack, TagChip, Text, Wrap } from "@rae/design-system";
import { useMemo } from "react";
import { duration, renderingLabel } from "../../lib/kinds.tsx";
import { useExplorer } from "../../store.ts";
import { plural } from "../../lib/text.ts";
import { CODE_BOX } from "./codeBox.ts";
import { NodeChip } from "./Relations.tsx";

/* The details panel's Next.js sections: a route (URL, params, methods, files), a "use cache" scope, a middleware. */

/** A route: its URL, parameters, HTTP methods and special files (layout first, then page…), each addable. */
const FILE_ORDER = ["layout", "template", "page", "route", "loading", "error", "global-error", "not-found", "default"];
export function RouteInfoView({ node }: { node: GraphNode }) {
  const r = node.route!;
  const files = Object.entries(r.files)
    .filter(([, id]) => !!id)
    .sort(([a], [b]) => FILE_ORDER.indexOf(a) - FILE_ORDER.indexOf(b));
  return (
    <Stack gap="3">
      <Box {...CODE_BOX}>
        <CodeToken kind="value">{r.url}</CodeToken>
      </Box>
      {(r.params.length > 0 || (r.methods?.length ?? 0) > 0) && (
        <Wrap gap="1.5">
          {r.methods?.map((m) => (
            <TagChip key={m} color="relation.fetches" mono>
              {m}
            </TagChip>
          ))}
          {r.params.map((p) => (
            <TagChip key={p} color="kind.route.solid" mono>
              {p}
            </TagChip>
          ))}
        </Wrap>
      )}
      {r.rendering && (
        <Box>
          <Eyebrow>Rendering</Eyebrow>
          <Flex align="flex-start" gap="2" mt="1.5">
            <TagChip
              color={r.rendering.blocking ? "red.solid" : r.rendering.mode === "dynamic" ? "orange.solid" : r.rendering.mode === "ppr" ? "purple.solid" : r.rendering.mode === "ssg" ? "teal.solid" : "green.solid"}
              mono
            >
              {renderingLabel(r.rendering)}
            </TagChip>
            <Stack gap="0.5" minW="0">
              {r.rendering.reasons.map((why, i) => (
                <Text key={i} fontSize="xs" color="fg.muted" wordBreak="break-word">
                  {why}
                </Text>
              ))}
            </Stack>
          </Flex>
        </Box>
      )}
      {r.middleware && (
        <Box>
          <Eyebrow>Middleware</Eyebrow>
          <Wrap gap="1.5" mt="1.5" align="center">
            <NodeChip id={r.middleware.id} anchor={node.id} />
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {r.middleware.matcher ? `matcher ${r.middleware.matcher}` : "no matcher: runs on every route"}
            </Text>
            {r.middleware.conditions?.map((c) => (
              <TagChip key={c} color="relation.runsBefore" mono>
                {c}
              </TagChip>
            ))}
          </Wrap>
        </Box>
      )}
      <Box>
        <Eyebrow>Files</Eyebrow>
        <Wrap gap="1.5" mt="1.5">
          {files.map(([role, id]) => (
            <NodeChip key={role} id={id!} anchor={node.id} suffix={role} />
          ))}
        </Wrap>
      </Box>
    </Stack>
  );
}

/** A "use cache" scope: variant, where the directive is, cacheLife (with revalidate / expire), tags, and what invalidates it. */
export function CacheView({ node }: { node: GraphNode }) {
  const c = node.cache!;
  // (select the index itself: a selector returning a fresh filtered array would re-render forever)
  const index = useExplorer((s) => s.index);
  const invalidatedBy = useMemo(() => (index?.in.get(node.id) ?? []).filter((e) => e.kind === "invalidates"), [index, node.id]);
  return (
    <Stack gap="2.5">
      <Box {...CODE_BOX}>
        <CodeToken kind="keyword">"{c.variant === "default" ? "use cache" : `use cache: ${c.variant}`}"</CodeToken>
        <CodeToken kind="punct">{c.scope === "file" ? "  — for the whole file" : "  — in this function"}</CodeToken>
        {c.life && (
          <Box>
            <CodeToken kind="name">cacheLife</CodeToken>
            <CodeToken kind="punct">(</CodeToken>
            <CodeToken kind="value">{c.life.startsWith("{") ? c.life : `"${c.life}"`}</CodeToken>
            <CodeToken kind="punct">)</CodeToken>
          </Box>
        )}
      </Box>
      {(c.revalidate !== undefined || c.expire !== undefined) && (
        <Text fontSize="xs" color="fg.muted">
          {c.revalidate !== undefined && `Revalidates every ${duration(c.revalidate)}`}
          {c.revalidate !== undefined && c.expire !== undefined && " · "}
          {c.expire !== undefined && `expires after ${duration(c.expire)}`}
          {!c.life && " (the default profile)"}
        </Text>
      )}
      {c.tags?.length ? (
        <Wrap gap="1.5">
          {c.tags.map((t) => (
            <TagChip key={t} color="relation.invalidates" mono>
              {t}
            </TagChip>
          ))}
        </Wrap>
      ) : null}
      {invalidatedBy.length > 0 && (
        <Box>
          <Eyebrow>Invalidated by</Eyebrow>
          <Wrap gap="1.5" mt="1.5">
            {invalidatedBy.map((e, i) => (
              <NodeChip key={i} id={e.from} anchor={node.id} suffix={e.specifiers?.[0]} />
            ))}
          </Wrap>
        </Box>
      )}
    </Stack>
  );
}

/** A middleware file: its matchers (with has / missing conditions) and how many routes they select. */
export function MiddlewareView({ node }: { node: GraphNode }) {
  const routes = useExplorer((s) => (s.index?.out.get(node.id) ?? []).filter((e) => e.kind === "runsBefore").length);
  const { matchers } = node.middleware!;
  return (
    <Stack gap="2">
      {matchers.length ? (
        matchers.map((m, i) => (
          <Box key={i} {...CODE_BOX}>
            <CodeToken kind="value">{m.source}</CodeToken>
            {(m.has?.length || m.missing?.length) && (
              <Wrap gap="1.5" mt="1.5">
                {m.has?.map((c) => (
                  <TagChip key={`h${c}`} color="relation.runsBefore" mono>
                    has {c}
                  </TagChip>
                ))}
                {m.missing?.map((c) => (
                  <TagChip key={`m${c}`} color="relation.revalidates" mono>
                    missing {c}
                  </TagChip>
                ))}
              </Wrap>
            )}
          </Box>
        ))
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No matcher: it runs before every route.
        </Text>
      )}
      <Text fontSize="xs" color="fg.muted">
        Runs before {plural(routes, "route")} (see Uses). Checks inside the function itself aren't evaluated.
      </Text>
    </Stack>
  );
}
