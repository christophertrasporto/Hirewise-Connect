import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { consumeMagicLink } from "@/server/services/auth.service";
import { writeSessionCookie, requestMeta } from "@/server/auth/cookies";
import { HOME_PATH } from "@/server/auth/require-actor";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    const meta = await requestMeta();
    const s = await consumeMagicLink(prisma, { token, ...meta });
    await writeSessionCookie(s.token, s.expiresAt);
    return NextResponse.redirect(new URL(HOME_PATH, req.url));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sign-in link failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, req.url));
  }
}
