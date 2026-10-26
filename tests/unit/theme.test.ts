import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COOKIE, THEME_INIT_SCRIPT, normalizeThemeChoice, resolveTheme, themeCookie } from "@/lib/theme";
import { DARK_BG, DARK_CTA_BG, DARK_CTA_BG_HOVER, DARK_LINE, DARK_SURFACES, DARK_TEXT } from "@/lib/dark-theme-palette";
import { generateDarkThemeCss } from "../../scripts/lib/dark-theme";

const root = join(__dirname, "..", "..");

describe("theme choice", () => {
  it("normalizes anything but light or dark to system", () => {
    expect(normalizeThemeChoice("light")).toBe("light");
    expect(normalizeThemeChoice("dark")).toBe("dark");
    for (const v of ["system", "", "blue", "DARK", null, undefined]) expect(normalizeThemeChoice(v as string | null | undefined)).toBe("system");
  });

  it("resolves system from the device and lets an explicit choice win", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("remembers light and dark for a year and clears the cookie for system", () => {
    expect(themeCookie("dark")).toBe(`${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`);
    expect(themeCookie("light")).toContain(`${THEME_COOKIE}=light;`);
    expect(themeCookie("system")).toContain("Max-Age=0");
    expect(themeCookie("dark")).not.toMatch(/secure|httponly/i); // the page script has to read it before paint
  });
});

describe("no-flash init script", () => {
  function run(cookie: string, prefersDark: boolean) {
    const attrs: Record<string, string> = {};
    const doc = { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    const win = { matchMedia: () => ({ matches: prefersDark }) };
    new Function("document", "window", THEME_INIT_SCRIPT)(doc, win);
    return attrs;
  }

  it("applies a saved choice before paint and otherwise follows the device", () => {
    expect(run(`a=1; ${THEME_COOKIE}=dark`, false)).toEqual({ "data-theme": "dark", "data-theme-choice": "dark" });
    expect(run(`${THEME_COOKIE}=light; b=2`, true)).toEqual({ "data-theme": "light", "data-theme-choice": "light" });
    expect(run("", true)).toEqual({ "data-theme": "dark", "data-theme-choice": "system" });
    expect(run("", false)).toEqual({ "data-theme": "light", "data-theme-choice": "system" });
  });

  it("ignores a tampered cookie value", () => {
    expect(run(`${THEME_COOKIE}=<script>`, false)).toEqual({ "data-theme": "light", "data-theme-choice": "system" });
  });

  it("never throws if storage is blocked", () => {
    const doc = {
      get cookie(): string {
        throw new Error("blocked");
      },
      documentElement: { setAttribute: () => undefined },
    };
    expect(() => new Function("document", "window", THEME_INIT_SCRIPT)(doc, { matchMedia: () => ({ matches: true }) })).not.toThrow();
  });
});

describe("dark theme stylesheet", () => {
  it("matches what the generator produces from the colour classes in src (run `npm run theme:gen` if this fails)", () => {
    const committed = readFileSync(join(root, "src", "app", "dark-theme.css"), "utf8");
    expect(committed).toBe(generateDarkThemeCss(join(root, "src")));
  });

  it("covers hover and focus states and turns filled controls brand green", () => {
    const css = readFileSync(join(root, "src", "app", "dark-theme.css"), "utf8");
    expect(css).toContain(":hover");
    expect(css).toMatch(/button\.bg-ink-900/);
    expect(css).toContain("color-scheme: dark");
  });
});

// WCAG 2.x contrast, with translucent tints blended over the surface they sit on.
type Rgb = [number, number, number];
function parse(value: string): { rgb: Rgb; alpha: number } {
  if (value.startsWith("#")) {
    const h = value.slice(1);
    return { rgb: [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)], alpha: 1 };
  }
  const m = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (!m) throw new Error(`cannot parse ${value}`);
  return { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : +m[4] };
}
const over = (top: string, base: Rgb): Rgb => {
  const { rgb, alpha } = parse(top);
  return [0, 1, 2].map((i) => rgb[i] * alpha + base[i] * (1 - alpha)) as Rgb;
};
const luminance = ([r, g, b]: Rgb) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const WHITE: Rgb = [255, 255, 255];
const surfaces = (["page", "sunken", "panel", "raised"] as const).map((k) => [k, parse(DARK_SURFACES[k]).rgb] as const);

describe("dark theme contrast (WCAG AA, 4.5:1)", () => {
  it.each(Object.entries(DARK_TEXT))("text-%s is readable on every dark surface", (token, value) => {
    for (const [name, surface] of surfaces) expect(contrast(over(value, surface), surface), `${token} on ${name}`).toBeGreaterThanOrEqual(4.5);
  });

  it("status text is readable on its own tint, sitting on a panel", () => {
    const panel = parse(DARK_SURFACES.panel).rgb;
    const pairs: Array<[text: string, tint: string]> = [
      ["brand-600", "brand-50"],
      ["brand-700", "brand-50"],
      ["brand-700", "brand-100"],
      ["brand-800", "brand-100"],
      ["gold-700", "gold-50"],
      ["gold-800", "gold-100"],
      ["red-600", "red-50"],
      ["red-700", "red-50"],
      ["red-700", "red-100"],
      ["orange-700", "orange-50"],
    ];
    for (const [text, tint] of pairs) {
      const bg = over(DARK_BG[tint], panel);
      expect(contrast(over(DARK_TEXT[text], bg), bg), `${text} on ${tint}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("white text on filled controls and brand fills clears AA", () => {
    for (const [name, fill] of [["cta", DARK_CTA_BG], ["cta hover", DARK_CTA_BG_HOVER], ["bg-brand-500", DARK_BG["brand-500"]], ["bg-brand-600", DARK_BG["brand-600"]]] as const) {
      expect(contrast(WHITE, parse(fill).rgb), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("borders and dividers are visible against the surfaces they separate (3:1 is not required for hairlines, but they must differ)", () => {
    const panel = parse(DARK_SURFACES.panel).rgb;
    for (const [token, value] of Object.entries(DARK_LINE)) expect(contrast(over(value, panel), panel), token).toBeGreaterThan(1.05);
  });
});
