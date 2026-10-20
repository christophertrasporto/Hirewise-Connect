import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";
import { handleInboundEmail } from "@/server/services/alias.service";

/**
 * Inbound email webhook (v2 phase 6a, decision 3). The email provider posts a JSON body
 * `{ to, from, subject, text }` with an `x-hirewise-signature` header holding the hex HMAC-SHA256 of the raw body
 * under INBOUND_EMAIL_SECRET. Routing is refused while `email.inboundEnabled` is off, so this endpoint is inert
 * until a provider is wired to it. Real addresses never leave this handler: the message is posted into the owner's
 * thread through the same masking rules as any other message.
 */
export const runtime = "nodejs";

function verify(raw: string, signature: string | null): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verify(raw, req.headers.get("x-hirewise-signature"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let body: { to?: unknown; from?: unknown; subject?: unknown; text?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (typeof body.to !== "string" || typeof body.from !== "string" || typeof body.text !== "string") return NextResponse.json({ error: "to, from, and text are required" }, { status: 400 });
  const r = await handleInboundEmail(prisma, { to: body.to, from: body.from, subject: typeof body.subject === "string" ? body.subject : null, text: body.text });
  return NextResponse.json({ accepted: r.accepted, reason: r.reason }, { status: r.accepted ? 202 : r.reason === "inbound routing disabled" ? 503 : 202 });
}
