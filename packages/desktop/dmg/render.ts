#!/usr/bin/env bun
/**
 * Renders background.html to the .dmg window's background: background.png (660 × 400) and
 * background@2x.png (1320 × 800, Retina; appdmg combines the two), transparent where nothing is
 * drawn (Finder's window shows through). Run after changing the HTML and commit the PNGs (the
 * build doesn't render them):
 *   bun packages/desktop/dmg/render.ts
 * Chromium: PW_CHROMIUM_PATH, otherwise Playwright's default lookup.
 */
import { chromium } from "playwright-core";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const here = import.meta.dir;
const designSystem = join(here, "../../design-system");
// the fonts the app ships (the design system's), not a network font: the same type as the app
const font = (family: string, file: string) =>
  `@font-face { font-family: "${family}"; font-weight: 100 900; src: url("${pathToFileURL(Bun.resolveSync(file, designSystem)).href}") format("woff2"); }`;
const fonts = [
  font("IBM Plex Sans Variable", "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2"),
  font("JetBrains Mono Variable", "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"),
].join("\n");

const tmp = mkdtempSync(join(tmpdir(), "rae-dmg-"));
const page = join(tmp, "background.html");
writeFileSync(page, readFileSync(join(here, "background.html"), "utf8").replace("/*FONTS*/", fonts));

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
try {
  for (const [scale, name] of [
    [1, "background.png"],
    [2, "background@2x.png"],
  ] as const) {
    const p = await browser.newPage({ viewport: { width: 660, height: 400 }, deviceScaleFactor: scale });
    await p.goto(pathToFileURL(page).href);
    await p.evaluate(() => document.fonts.ready);
    await p.locator(".window").screenshot({ path: join(here, name), omitBackground: true });
    await p.close();
    console.log(`✔ ${name}`);
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
