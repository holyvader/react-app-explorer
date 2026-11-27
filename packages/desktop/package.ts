#!/usr/bin/env bun
/**
 * Packages the desktop app for macOS: `React App Explorer.app` with the sidecar (built by
 * `bun run sidecar` into binaries/), tsgo and the loading page as resources, signed ad hoc, and a
 * .dmg next to it in out/. The version is package.json's.
 *   bun run build      (sidecar + this)
 */
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dir;
const binaries = join(here, "binaries");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const triple = arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
const { version } = await Bun.file(join(here, "package.json")).json();
const name = "React App Explorer";
const out = join(here, "out");

// the resources, at the names main.cjs looks for
const stage = join(out, "stage");
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(binaries, `rae-server-${triple}`), join(stage, "rae-server"));
cpSync(join(binaries, "tsgo"), join(stage, "tsgo"), { recursive: true });
cpSync(join(here, "loading"), join(stage, "loading"), { recursive: true });

const [appDir] = await packager({
  dir: here,
  out,
  name,
  platform: "darwin",
  arch,
  appVersion: version,
  appBundleId: "dev.rae.explorer",
  appCategoryType: "public.app-category.developer-tools",
  icon: join(here, "icons/icon.icns"),
  darwinDarkModeSupport: true,
  // the sidecar is a Bun executable: Bun needs macOS 13
  extendInfo: { LSMinimumSystemVersion: "13.0" },
  asar: true,
  overwrite: true,
  prune: false,
  // only main.cjs and package.json go into the app
  ignore: [/^\/node_modules/, /^\/out/, /^\/binaries/, /^\/icons/, /^\/loading/, /^\/package\.ts$/, /^\/icon\.svg$/],
  extraResource: [join(stage, "rae-server"), join(stage, "tsgo"), join(stage, "loading")],
});
const app = join(appDir!, `${name}.app`);

// ad hoc signature: the nested executables first, then the bundle (Apple Silicon won't run unsigned code)
const resources = join(app, "Contents/Resources");
for (const bin of [join(resources, "rae-server"), join(resources, "tsgo/tsc")]) execFileSync("codesign", ["--force", "--sign", "-", bin], { stdio: "inherit" });
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });

// the .dmg: the app and a link to /Applications
const dmgSrc = join(out, "dmg");
mkdirSync(dmgSrc);
cpSync(app, join(dmgSrc, `${name}.app`), { recursive: true, verbatimSymlinks: true });
symlinkSync("/Applications", join(dmgSrc, "Applications"));
const dmg = join(out, `React App Explorer_${version}_${arch}.dmg`);
execFileSync("hdiutil", ["create", "-volname", name, "-srcfolder", dmgSrc, "-ov", "-format", "UDZO", dmg], { stdio: "inherit" });
rmSync(dmgSrc, { recursive: true, force: true });
rmSync(stage, { recursive: true, force: true });
console.log(`\n${app}\n${dmg}`);
