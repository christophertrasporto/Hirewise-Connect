import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentAuth } from "@/server/auth/require-actor";
import { exportClientData } from "@/server/services/export.service";
import { ForbiddenError } from "@/server/policies/authorize";

export const runtime = "nodejs";

/** Own-data export for the signed-in client (JSON download). */
export async function GET() {
  const auth = await getCurrentAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await exportClientData(prisma, auth.actor);
    return new NextResponse(JSON.stringify(data, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="hirewise-connect-export-${data.exportedAt.slice(0, 10)}.json"` } });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}
