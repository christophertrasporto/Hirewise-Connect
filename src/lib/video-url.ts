/** Pure helpers shared by the server (completion rules) and the lesson renderer. */

/** The YouTube video id for watch, short, embed, and youtu.be URLs; null for anything else. */
export function youTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") return parts[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
