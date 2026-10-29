import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DARK_BG,
  DARK_BG_RGB,
  DARK_CTA_BG,
  DARK_CTA_BG_HOVER,
  DARK_CTA_ELEMENTS,
  DARK_LINE,
  DARK_SURFACES,
  DARK_TEXT,
  DARK_VARIABLES,
} from "../../src/lib/dark-theme-palette";

/**
 * Builds the dark theme's colour overrides from the colour classes the source actually uses, so no page has to be
 * edited to support dark mode. Run `npm run theme:gen` after adding colour classes; `tests/unit/theme.test.ts` fails
 * when `src/app/dark-theme.css` is out of date or a class cannot be handled.
 */

const FAMILIES = "ink|brand|gold|red|orange|white|black|transparent";
const SHADES = "50|100|200|300|400|500|600|700|800|900|950";
const UTILS = "bg|text|border|border-[trblxy]|divide|ring|placeholder|from|to|via|fill|stroke|outline|decoration|accent|caret|shadow";
const CLASS_RE = new RegExp(`(?<![\\w-])((?:[a-z0-9\\-\\[\\]:&>_*()]+:)?)(${UTILS})-((?:${FAMILIES})(?:-(?:${SHADES}))?)(\\/\\d+)?(?![\\w-])`, "g");

/** Utilities this generator knows how to override. Anything else with a mapped colour is an error, not a silent gap. */
const HANDLED = new Set(["bg", "text", "border", "border-t", "border-r", "border-b", "border-l", "border-x", "border-y", "divide", "ring", "from", "via", "to"]);
/** Utilities whose colours read fine on dark surfaces as they are (form accents, strike-through lines, shadow colours). */
const IDENTITY_OK = /^(?:accent-|decoration-|shadow-|bg-(?:transparent|black)|text-(?:transparent|black)|border-transparent)/;

export type ColourClass = { raw: string; variant: string; util: string; colour: string; opacity: string };

export function collectColourClasses(srcDir: string): ColourClass[] {
  const found = new Map<string, ColourClass>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?)$/.test(e.name)) {
        for (const m of readFileSync(p, "utf8").matchAll(CLASS_RE)) {
          const [raw, variant, util, colour, opacity] = m;
          found.set(raw, { raw, variant: variant ?? "", util, colour, opacity: opacity ?? "" });
        }
      }
    }
  };
  walk(srcDir);
  return [...found.values()].sort((a, b) => a.raw.localeCompare(b.raw));
}

const escapeClass = (cls: string) => cls.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
const ROOT = ':root[data-theme="dark"]';

type Variant = { order: number; selector: (cls: string) => string; media?: string };
const VARIANTS: Record<string, Variant> = {
  "": { order: 0, selector: (c) => `.${c}` },
  "placeholder:": { order: 1, selector: (c) => `.${c}::placeholder` },
  "file:": { order: 1, selector: (c) => `.${c}::file-selector-button` },
  "hover:": { order: 2, selector: (c) => `.${c}:hover`, media: "(hover: hover)" },
  "focus:": { order: 3, selector: (c) => `.${c}:focus` },
  "focus-visible:": { order: 3, selector: (c) => `.${c}:focus-visible` },
  "disabled:": { order: 4, selector: (c) => `.${c}:disabled` },
  "open:": { order: 5, selector: (c) => `.${c}[open]` },
  "has-[:checked]:": { order: 5, selector: (c) => `.${c}:has(:checked)` },
  "group-hover:": { order: 6, selector: (c) => `.group:hover .${c}`, media: "(hover: hover)" },
  "group-open:": { order: 6, selector: (c) => `.group[open] .${c}` },
};

const LIGHT_VALUE = (colour: string): string => (colour === "white" ? "#fff" : colour === "black" ? "#000" : colour === "transparent" ? "transparent" : `var(--color-${colour})`);

/** Scales the alpha of an `rgb(r g b / a)` tint; a hex surface becomes a translucent version of itself. */
function withOpacity(value: string, opacity: number): string {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (m) return `rgb(${m[1]} ${m[2]} ${m[3]} / ${+(Number(m[4]) * opacity).toFixed(3)})`;
  const h = value.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)} / ${opacity})`;
}

/** The dark colour for a class, or null when the class keeps its light-theme colour. */
function darkValue(c: ColourClass): string | null {
  const isBg = c.util === "bg";
  const isText = c.util === "text";
  if (isBg) {
    if (c.opacity) {
      const rgb = DARK_BG_RGB[c.colour];
      if (rgb) return `rgb(${rgb} / ${Number(c.opacity.slice(1)) / 100})`;
      const tint = DARK_BG[c.colour];
      return tint?.startsWith("rgb(") ? withOpacity(tint, Number(c.opacity.slice(1)) / 100) : null;
    }
    // Hover on a filled call-to-action darkens it in the light theme; in the dark theme it brightens.
    if (c.variant === "hover:" && (c.colour === "ink-700" || c.colour === "ink-800")) return DARK_CTA_BG_HOVER;
    if (c.variant === "hover:" && c.colour === "ink-950") return DARK_CTA_BG_HOVER;
    if (c.colour === "ink-900" || c.colour === "ink-800" || c.colour === "ink-950") return c.colour === "ink-900" ? DARK_SURFACES.navy : null;
    return DARK_BG[c.colour] ?? null;
  }
  if (isText) return DARK_TEXT[c.colour] ?? null;
  if (c.util === "from" || c.util === "via" || c.util === "to") {
    const v = DARK_BG[c.colour] ?? (c.colour === "ink-200" ? DARK_LINE["ink-200"] : null);
    return v && c.opacity ? withOpacity(v, Number(c.opacity.slice(1)) / 100) : v;
  }
  return DARK_LINE[c.colour] ?? null;
}

function declaration(c: ColourClass, value: string): string {
  if (c.util === "bg") return `background-color: ${value};`;
  if (c.util === "text") return `color: ${value};`;
  if (c.util === "ring") return `--tw-ring-color: ${value};`;
  if (c.util === "from" || c.util === "via" || c.util === "to") return `--tw-gradient-${c.util}: ${value};`;
  return `border-color: ${value};`;
}

type Rule = { order: number; media?: string; css: string };

export function generateDarkThemeCss(srcDir: string): string {
  const classes = collectColourClasses(srcDir);
  const problems: string[] = [];
  const rules: Rule[] = [];
  const mappedColours = new Set(["ink", "brand", "gold", "red", "orange", "white"]);

  for (const c of classes) {
    const family = c.colour.split("-")[0];
    const variant = VARIANTS[c.variant];
    if (!mappedColours.has(family)) continue;
    if (c.variant && !variant) {
      problems.push(`${c.raw}: unsupported variant "${c.variant}"`);
      continue;
    }
    if (!HANDLED.has(c.util)) {
      if (!IDENTITY_OK.test(c.raw)) problems.push(`${c.raw}: utility "${c.util}" is not handled by the dark theme generator`);
      continue;
    }
    const value = darkValue(c);
    const v = variant ?? VARIANTS[""];
    const cls = escapeClass(c.raw);
    const sel = (s: string) => `${ROOT} ${s}`;
    // Opacity variants of an unmapped colour keep Tailwind's own output, so skip them.
    if (value === null) {
      // A hover/focus class of an unmapped colour must still beat a base override on the same element.
      if (c.variant && !c.opacity && (c.util === "bg" || c.util === "text" || c.util === "border" || c.util === "ring")) {
        rules.push({ order: v.order, media: v.media, css: `${sel(v.selector(cls))} { ${declaration(c, LIGHT_VALUE(c.colour))} }` });
      }
      continue;
    }
    if (c.util === "divide") continue;
    rules.push({ order: v.order, media: v.media, css: `${sel(v.selector(cls))} { ${declaration(c, value)} }` });
    if (c.util === "bg" && c.colour === "ink-900" && !c.variant && !c.opacity) {
      const ctas = DARK_CTA_ELEMENTS.map((el) => `${sel(`${el}.${cls}`)}`).join(",\n");
      rules.push({ order: 0.5, css: `${ctas} { background-color: ${DARK_CTA_BG}; }` });
    }
  }

  // Dividers are borders on children, so they need their own selector shape.
  for (const c of classes) {
    if (c.util !== "divide" || c.variant) continue;
    const value = DARK_LINE[c.colour];
    if (value) rules.push({ order: 0, css: `${ROOT} .${escapeClass(c.raw)} > :not(:last-child) { border-color: ${value}; }` });
  }

  if (problems.length) throw new Error(`Dark theme generator cannot handle:\n${problems.join("\n")}`);

  const sorted = [...rules].sort((a, b) => a.order - b.order || a.css.localeCompare(b.css));
  const body: string[] = [];
  for (const r of sorted) body.push(r.media ? `@media ${r.media} {\n${r.css.replace(/^/gm, "  ")}\n}` : r.css);

  const vars = Object.entries(DARK_VARIABLES)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return [
    "/* GENERATED by scripts/gen-dark-theme.ts from src/lib/dark-theme-palette.ts. Do not edit; run `npm run theme:gen`. */",
    `${ROOT} {\n  color-scheme: dark;\n${vars}\n}`,
    ...body,
    "",
  ].join("\n");
}
