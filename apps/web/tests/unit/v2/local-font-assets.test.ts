import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fonts = ["noto-sans-kr", "noto-serif-kr", "source-serif-4", "jetbrains-mono"];

test("all configured fonts resolve to pinned local assets with distributed licenses", () => {
  const layout = readFileSync(resolve(appRoot, "src/app/layout.tsx"), "utf8");
  const dependencies = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")).dependencies;
  expect(layout).not.toContain("next/font/google");
  for (const font of fonts) {
    const name = `@fontsource-variable/${font}`;
    expect(dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(layout).toContain(`${name}/wght.css`);
    const cssPath = require.resolve(`${name}/wght.css`);
    const css = readFileSync(cssPath, "utf8");
    expect(css).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//);
    const files = [...css.matchAll(/url\(([^)]+)\)/g)];
    expect(files.length).toBeGreaterThan(0);
    for (const [, file] of files) expect(existsSync(resolve(dirname(cssPath), file))).toBe(true);
    expect(readFileSync(resolve(appRoot, `public/licenses/fonts/${font}.txt`), "utf8"))
      .toBe(readFileSync(require.resolve(`${name}/LICENSE`), "utf8"));
  }
});

test("font tokens preserve all four families and Korean unicode subsets", () => {
  const tokens = readFileSync(resolve(appRoot, "src/styles/local-fonts.css"), "utf8");
  for (const [token, family] of [["sans", "Noto Sans KR"], ["serif", "Noto Serif KR"], ["display", "Source Serif 4"], ["mono", "JetBrains Mono"]]) {
    expect(tokens).toContain(`--font-${token}: "${family} Variable"`);
  }
  for (const font of fonts.slice(0, 2)) {
    const css = readFileSync(require.resolve(`@fontsource-variable/${font}/wght.css`), "utf8");
    expect(css).toContain("unicode-range:");
    expect(css).toMatch(/ac00/i);
    expect(css).toContain("font-display: swap");
  }
});
