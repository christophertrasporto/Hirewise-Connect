import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, type RequestMeta } from "./session";

export async function readSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function writeSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

/** IP and user agent for audit and agreement acceptance records (INV-I2). */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ipAddress = (forwarded ? forwarded.split(",")[0] : h.get("x-real-ip")) ?? null;
  return { ipAddress: ipAddress?.trim() || null, userAgent: h.get("user-agent")?.slice(0, 512) ?? null };
}
