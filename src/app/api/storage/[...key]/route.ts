import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getEnv } from "@/server/env";
import { getStorage, LocalDiskStorage } from "@/server/adapters/storage";

/**
 * Local-disk storage endpoint used only when STORAGE_DRIVER=local.
 * URLs are HMAC-signed and time-limited by LocalDiskStorage, mirroring S3 presigned URLs.
 * In production with S3/R2 this route returns 404 and browsers talk to the bucket directly.
 */
export const runtime = "nodejs";

const MAX_PUT_BYTES = 200 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

function local(): LocalDiskStorage | null {
  if (getEnv().STORAGE_DRIVER !== "local") return null;
  const s = getStorage();
  return s instanceof LocalDiskStorage ? s : null;
}

function verify(req: NextRequest, key: string, method: "GET" | "PUT"): LocalDiskStorage | NextResponse {
  const s = local();
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  if (!exp || !s.verify(key, exp, method, sig)) return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  return s;
}

function keyFrom(params: { key: string[] }) {
  const key = params.key.map(decodeURIComponent).join("/");
  if (key.includes("..") || key.startsWith("/")) return null;
  return key;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const key = keyFrom(await ctx.params);
  if (!key) return NextResponse.json({ error: "Bad key" }, { status: 400 });
  const s = verify(req, key, "PUT");
  if (s instanceof NextResponse) return s;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_PUT_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const body = Buffer.from(await req.arrayBuffer());
  if (body.byteLength > MAX_PUT_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  await s.put(key, body, req.headers.get("content-type") ?? "application/octet-stream");
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const key = keyFrom(await ctx.params);
  if (!key) return NextResponse.json({ error: "Bad key" }, { status: 400 });
  const s = verify(req, key, "GET");
  if (s instanceof NextResponse) return s;
  const abs = path.resolve(getEnv().STORAGE_LOCAL_DIR, key);
  try {
    const data = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: { "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=300", "Content-Disposition": "inline" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
