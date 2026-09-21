import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db/client";
import { verifyEmail } from "@/server/services/auth.service";
import { getCurrentAuth, HOME_PATH } from "@/server/auth/require-actor";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    await verifyEmail(prisma, token);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Verification failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, req.url));
  }
  const auth = await getCurrentAuth();
  return NextResponse.redirect(new URL(auth ? HOME_PATH : "/login?verified=1", req.url));
}
