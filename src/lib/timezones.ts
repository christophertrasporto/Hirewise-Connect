/** Current UTC offset in hours for an IANA timezone, or null if unknown. */
export function timezoneOffsetHours(tz: string, at = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    return Math.round(((asUtc - at.getTime()) / 3_600_000) * 2) / 2;
  } catch {
    return null;
  }
}

export function formatOffset(h: number | null): string {
  if (h === null) return "";
  const sign = h >= 0 ? "+" : "−";
  const abs = Math.abs(h);
  return `UTC${sign}${Math.floor(abs)}${abs % 1 ? ":30" : ""}`;
}
