import { getEnv } from "@/server/env";

/**
 * Meeting link provider behind an interface (Section 13 Phase 5: calendar/Zoom link integration).
 * Sales may still paste a link (Q10); when none is given and a provider is configured, one is created.
 * `none` keeps Phase 2 behaviour; `fake` is the local stand-in; `zoom` uses Server-to-Server OAuth.
 */
export type MeetingRequest = { topic: string; startAt: Date; durationMin: number; timezone: string; agenda?: string };
export type Meeting = { provider: string; externalId: string; joinUrl: string };

export interface MeetingProvider {
  readonly name: "none" | "fake" | "zoom";
  createMeeting(req: MeetingRequest): Promise<Meeting | null>;
  cancelMeeting(externalId: string): Promise<void>;
}

export class NoMeetingProvider implements MeetingProvider {
  readonly name = "none" as const;
  async createMeeting() {
    return null;
  }
  async cancelMeeting() {}
}

/** Deterministic local fake: same request → same link. */
export class FakeMeetingProvider implements MeetingProvider {
  readonly name = "fake" as const;
  readonly created: Array<MeetingRequest & { externalId: string }> = [];
  async createMeeting(req: MeetingRequest): Promise<Meeting> {
    const externalId = `fake-${req.startAt.getTime().toString(36)}-${req.durationMin}`;
    this.created.push({ ...req, externalId });
    return { provider: "fake", externalId, joinUrl: `https://meet.hirewise.example/${externalId}` };
  }
  async cancelMeeting() {}
}

export class ZoomMeetingProvider implements MeetingProvider {
  readonly name = "zoom" as const;
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private accountId: string, private clientId: string, private clientSecret: string) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(this.accountId)}`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}` } });
    if (!res.ok) throw new Error(`Zoom auth failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async createMeeting(req: MeetingRequest): Promise<Meeting> {
    const token = await this.accessToken();
    const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ topic: req.topic, type: 2, start_time: req.startAt.toISOString(), duration: req.durationMin, timezone: req.timezone, agenda: req.agenda ?? "", settings: { join_before_host: false, waiting_room: true } }),
    });
    if (!res.ok) throw new Error(`Zoom meeting creation failed: ${res.status}`);
    const json = (await res.json()) as { id: number; join_url: string };
    return { provider: "zoom", externalId: String(json.id), joinUrl: json.join_url };
  }

  async cancelMeeting(externalId: string) {
    const token = await this.accessToken();
    await fetch(`https://api.zoom.us/v2/meetings/${externalId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  }
}

let instance: MeetingProvider | null = null;

export function getMeetingProvider(): MeetingProvider {
  if (instance) return instance;
  const env = getEnv();
  instance = env.MEETING_PROVIDER === "zoom" ? new ZoomMeetingProvider(env.ZOOM_ACCOUNT_ID!, env.ZOOM_CLIENT_ID!, env.ZOOM_CLIENT_SECRET!) : env.MEETING_PROVIDER === "fake" ? new FakeMeetingProvider() : new NoMeetingProvider();
  return instance;
}

export function setMeetingProviderForTests(p: MeetingProvider | null) {
  instance = p;
}
