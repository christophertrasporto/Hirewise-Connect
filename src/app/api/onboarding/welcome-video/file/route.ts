import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { welcomeVideoFileUrl } from "@/server/services/onboarding.service";
import { NotFoundError } from "@/server/policies/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams the uploaded welcome video through a short-lived signed URL; any signed-in user may watch it. */
export async function GET() {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = await welcomeVideoFileUrl(prisma, auth.actor);
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw e;
  }
}
