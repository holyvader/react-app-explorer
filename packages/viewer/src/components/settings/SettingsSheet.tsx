import {
  ActionIconButton,
  Box,
  Button,
  DIAGRAM_PALETTES,
  type DiagramPaletteId,
  Flex,
  Input,
  Panel,
  PanelBar,
  SearchInput,
  SegmentedControl,
  Select,
  setColorMode,
  setDiagramPalette,
  setTextSize,
  SwitchField,
  Text,
  TEXT_SIZES,
  textPx,
  type TextSize,
  useColorMode,
  useDiagramPalette,
  useTextSize,
} from "@rae/design-system";
import { IconClear, IconClose, IconLibrary } from "@rae/design-system/icons";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import type { LayoutMode } from "../../graph/squareLayout.ts";
import { EDITORS, type EditorKind } from "../../lib/editor.ts";
import { readSetting, writeSetting } from "../../lib/settings.ts";
import { useExplorer } from "../../store.ts";

/** The sheet's width (px) until resized: docked beside the canvas, which narrows instead of being covered. */
export const SETTINGS_WIDTH = 360;
const WIDTH_KEY = "rae.settingsWidth";

const LAYOUT_MODES = [
  { value: "tree", label: "Tree" },
  { value: "square", label: "Squares" },
];
const SECTIONS = ["Appearance", "Diagram", "Code health", "Editor", "This diagram"] as const;

/**
 * One setting: where it's listed, what it's called, a quieter line under it, more words search
 * finds it by, and its control. A new option is one more entry here: grouped, searchable, done.
 */
interface Setting {
  id: string;
  section: (typeof SECTIONS)[number];
  label: string;
  hint?: string;
  keywords?: string;
  /** Switches render their own row (the label toggles them); everything else sits on the right. */
  switch?: { checked: boolean; onChange: (on: boolean) => void };
  control?: ReactNode;
}

/** A whole number of at least `min`, taken when it's valid (typing "1" on the way to "150" waits for blur). */
function NumberSetting({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= min) onChange(n);
    else setDraft(String(value));
  };
  return (
    <Input
      type="number"
      min={min}
      step={1}
      size="xs"
      width="80px"
      textAlign="right"
      fontFamily="mono"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

/** `text` with what matches `query` marked. */
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Box as="mark" bg="diff.changed.subtle" color="diff.changed.fg" rounded="2px" px="1px">
        {text.slice(i, i + query.length)}
      </Box>
      {text.slice(i + query.length)}
    </>
  );
}

/**
 * Settings, docked on the right of the canvas (the toolbar's settings button, ⌘,): every change
 * shows on the diagram at once. Always mounted, so it slides in and out like the other panels. Grouped by what they change, with a search over names, hints and
 * keywords. Esc (in the sheet) or ⌘, again closes it.
 */
export function SettingsSheet({ onLibraries }: { onLibraries: () => void }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mode = useColorMode();
  const textSize = useTextSize();
  const palette = useDiagramPalette();
  const editor = useExplorer((s) => s.editor);
  const editors = useExplorer((s) => s.editors);
  const excluded = useExplorer((s) => s.excluded);
  const hideAllLibraries = useExplorer((s) => s.hideAllLibraries);
  const showAssets = useExplorer((s) => s.showAssets);
  const animateEdges = useExplorer((s) => s.animateEdges);
  const confirmAbove = useExplorer((s) => s.confirmAbove);
  const addWithFile = useExplorer((s) => s.addWithFile);
  const bigFile = useExplorer((s) => s.bigFile);
  const layoutMode = useExplorer((s) => s.layoutMode);
  const hasDiagram = useExplorer((s) => s.visible.length > 0);
  const { setEditor, setShowAssets, setAnimateEdges, setConfirmAbove, setAddWithFile, setBigFile, setLayoutMode, clear, setSettingsOpen } = useExplorer.getState();

  const open = useExplorer((s) => s.settingsOpen);
  const [width, setWidth] = useState(() => readSetting(WIDTH_KEY, SETTINGS_WIDTH));
  const resize = (w: number) => {
    setWidth(w);
    writeSetting(WIDTH_KEY, w);
  };
  // opening puts the cursor in the search
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const editorOptions = editors ? EDITORS.filter((e) => editors.includes(e.value)) : EDITORS;
  const settings: Setting[] = [
    {
      id: "theme",
      section: "Appearance",
      label: "Theme",
      keywords: "dark mode light mode colour color scheme",
      control: (
        <SegmentedControl
          label="Theme"
          value={mode}
          onValueChange={(v) => setColorMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      ),
    },
    {
      id: "text",
      section: "Appearance",
      label: "Text size",
      hint: "Panels and toolbar",
      keywords: "font zoom bigger smaller",
      control: <Select value={textSize} onValueChange={(v) => setTextSize(v as TextSize)} options={TEXT_SIZES} width="130px" size="xs" label="Text size" />,
    },
    {
      id: "palette",
      section: "Appearance",
      label: "Diagram colours",
      hint: DIAGRAM_PALETTES.find((p) => p.value === palette)?.hint,
      keywords: "palette colors kinds",
      control: <Select value={palette} onValueChange={(v) => setDiagramPalette(v as DiagramPaletteId)} options={DIAGRAM_PALETTES} width="130px" size="xs" label="Diagram colours" />,
    },
    {
      id: "layout",
      section: "Diagram",
      label: "Layout",
      hint: layoutMode === "tree" ? "Callers above what they call" : "Each folder in a square",
      keywords: "tree squares arrange placement",
      control: <SegmentedControl label="Layout" value={layoutMode} onValueChange={(v) => setLayoutMode(v as LayoutMode)} options={LAYOUT_MODES} />,
    },
    {
      id: "animate",
      section: "Diagram",
      label: "Animate relations",
      hint: "Each relation flows its own way · zoomed in, up to 120 on screen",
      keywords: "animation edges motion flow dashes",
      switch: { checked: animateEdges, onChange: setAnimateEdges },
    },
    {
      id: "with-file",
      section: "Diagram",
      label: "Add with their file",
      hint: "A component, hook or function comes with the file it's in, as its row",
      keywords: "file frame module parent declaration row",
      switch: { checked: addWithFile, onChange: setAddWithFile },
    },
    {
      id: "confirm",
      section: "Diagram",
      label: "Ask before adding more than",
      hint: "Elements at once: up to the root, down to the leaves, everything inside",
      keywords: "confirm warning limit expansion batch add all many",
      control: <NumberSetting label="Ask before adding more than" value={confirmAbove} min={1} onChange={setConfirmAbove} />,
    },
    {
      id: "assets",
      section: "Diagram",
      label: "Asset files",
      hint: "CSS, images, JSON",
      keywords: "assets styles images json files",
      switch: { checked: showAssets, onChange: setShowAssets },
    },
    {
      id: "libraries",
      section: "Diagram",
      label: "Libraries",
      hint: hideAllLibraries ? "All hidden" : excluded.length ? `${excluded.length} hidden` : "All shown",
      keywords: "packages node_modules external dependencies hide",
      control: (
        <Button size="2xs" variant="outline" rounded="l2" onClick={onLibraries}>
          <IconLibrary size={12} /> Choose…
        </Button>
      ),
    },
    {
      id: "big-lines",
      section: "Code health",
      label: "Big file: lines",
      hint: "More lines than this: a red badge on the file",
      keywords: "large file size length loc badge warning",
      control: <NumberSetting label="Big file: lines" value={bigFile.lines} min={1} onChange={(lines) => setBigFile({ lines })} />,
    },
    {
      id: "big-functions",
      section: "Code health",
      label: "Big file: functions",
      hint: "More components, hooks and functions than this: a red badge",
      keywords: "large file methods declarations count badge warning",
      control: <NumberSetting label="Big file: functions" value={bigFile.functions} min={1} onChange={(functions) => setBigFile({ functions })} />,
    },
    {
      id: "editor",
      section: "Editor",
      label: "Open files in",
      hint: editors && !editors.length ? "Install IntelliJ IDEA, WebStorm, VS Code, Cursor or Zed, then restart the app" : undefined,
      keywords: "editor ide intellij vscode cursor zed webstorm",
      control: (
        <Select
          value={editors && !editors.length ? "" : editor}
          onValueChange={(v) => setEditor(v as EditorKind)}
          options={editors && !editors.length ? [] : editorOptions}
          placeholder={editors && !editors.length ? "No editor found" : undefined}
          disabled={!!editors && !editors.length}
          width="130px"
          size="xs"
          label="Open files in"
        />
      ),
    },
    {
      id: "clear",
      section: "This diagram",
      label: "Clear the canvas",
      hint: "Takes every element off (⌘Z brings them back)",
      keywords: "reset remove empty delete all",
      control: (
        <Button size="2xs" variant="outline" rounded="l2" color="red.fg" disabled={!hasDiagram} onClick={() => clear()}>
          <IconClear size={12} /> Clear
        </Button>
      ),
    },
  ];

  const q = query.trim().toLowerCase();
  const shown = q ? settings.filter((s) => `${s.label} ${s.hint ?? ""} ${s.keywords ?? ""} ${s.section}`.toLowerCase().includes(q)) : settings;

  return (
    // the docked panels' Panel: it slides open and shut (width and fade, 200ms), folded away entirely
    <Panel
      resize={{ width, onWidthChange: resize, defaultWidth: SETTINGS_WIDTH, min: 300, max: 560 }}
      collapse={{ collapsed: !open, strip: null, width: 0 }}
      as="aside"
      aria-label="Settings"
      fontSize={textPx(12.5)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setSettingsOpen(false);
        }
      }}
    >
      <PanelBar label="Settings" sticky>
        <Text as="span" fontFamily="mono" fontSize={textPx(10.5)} color="fg.subtle" borderWidth="1px" borderColor="border" rounded="4px" px="1.5" mr="1">
          ⌘,
        </Text>
        <ActionIconButton label="Close settings" icon={<IconClose />} size="2xs" color="fg.subtle" onClick={() => setSettingsOpen(false)} />
      </PanelBar>
      <Box px="4" pt="3" pb="4">
        <SearchInput ref={searchRef} value={query} onValueChange={setQuery} placeholder="Search settings" size="sm" aria-label="Search settings" />
      </Box>
      {!shown.length && (
        <Text px="4" py="3" color="fg.muted">
          No setting matches “{query}”.
        </Text>
      )}
      {SECTIONS.map((section) => {
        const rows = shown.filter((s) => s.section === section);
        if (!rows.length) return null;
        return (
          <Box key={section} borderTopWidth="1px" borderColor="border.muted" pt="3" pb="2">
            <Text textStyle="panelLabel" color="fg.subtle" px="4" pt="1" pb="2">
              {section}
            </Text>
            {rows.map((s) => (
              <Fragment key={s.id}>
                {s.switch ? (
                  <Box py="2">
                    <SwitchField
                      size="xs"
                      px="4"
                      minH="40px"
                      ariaLabel={s.label}
                      label={<Marked text={s.label} query={q} />}
                      hint={s.hint && <Marked text={s.hint} query={q} />}
                      checked={s.switch.checked}
                      onCheckedChange={s.switch.onChange}
                    />
                  </Box>
                ) : (
                  <Flex align="center" gap="4" px="4" py="2" minH="56px">
                    <Box flex="1" minW="0" display="flex" flexDirection="column" gap="0.5">
                      <Text>
                        <Marked text={s.label} query={q} />
                      </Text>
                      {s.hint && (
                        <Text fontSize={textPx(11)} color="fg.subtle">
                          <Marked text={s.hint} query={q} />
                        </Text>
                      )}
                    </Box>
                    {s.control}
                  </Flex>
                )}
              </Fragment>
            ))}
          </Box>
        );
      })}
    </Panel>
  );
}
