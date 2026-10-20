/**
 * Interview meeting links (v2 phase 6a, decision 2). Interviews run on Hirewise-owned or allow-listed hosts only;
 * agency calendars, personal rooms, and unknown hosts are refused so no contact route reaches the other side.
 */

export const DEFAULT_ALLOWED_MEETING_HOSTS = ["meet.hirewise.example", "zoom.us", "meet.google.com", "teams.microsoft.com", "teams.live.com"];

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when the host equals, or is a subdomain of, one of the allowed hosts. */
export function isAllowedMeetingHost(url: string, allowedHosts: readonly string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return allowedHosts.some((a) => {
    const allowed = a.trim().toLowerCase();
    return !!allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}

export function meetingHostOf(url: string): string | null {
  return hostOf(url);
}
