/** Minimal iCalendar builder for "Add to calendar" links. No dependencies. */
export type IcsEvent = { uid: string; title: string; description?: string; location?: string; startAt: Date; durationMin: number; url?: string };

function stamp(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(ev: IcsEvent): string {
  const end = new Date(ev.startAt.getTime() + ev.durationMin * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hirewise Connect//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@hirewise-connect`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.startAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    ...(ev.description ? [`DESCRIPTION:${esc(ev.description)}`] : []),
    ...(ev.location ? [`LOCATION:${esc(ev.location)}`] : []),
    ...(ev.url ? [`URL:${ev.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

/** Google Calendar template link, useful alongside the .ics download. */
export function googleCalendarUrl(ev: IcsEvent): string {
  const end = new Date(ev.startAt.getTime() + ev.durationMin * 60_000);
  const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${stamp(ev.startAt)}/${stamp(end)}`, details: ev.description ?? "", location: ev.location ?? "" });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
