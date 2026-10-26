/**
 * Light and dark theme support. The visitor's choice lives in a first-party cookie (light, dark, or absent for "follow
 * my device") and is applied by a tiny inline script before the first paint, so there is no flash. The root layout
 * stays static: it never reads the cookie on the server.
 */

export const THEME_COOKIE = "hw_theme";
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function normalizeThemeChoice(value: string | null | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  return choice === "system" ? (systemPrefersDark ? "dark" : "light") : choice;
}

/** The cookie string for a choice; "system" clears it. One year, site-wide, readable by script (it holds no secret). */
export function themeCookie(choice: ThemeChoice): string {
  return choice === "system" ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` : `${THEME_COOKIE}=${choice}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** Runs in <head> before paint. Self-contained, no imports; kept small on purpose. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);var c=m?m[1]:"system";var d=c==="dark"||(c==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.setAttribute("data-theme",d?"dark":"light");e.setAttribute("data-theme-choice",c);}catch(x){}})();`;
