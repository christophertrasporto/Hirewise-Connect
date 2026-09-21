import type { Db } from "@/server/db/types";
import { sessionRepository } from "@/server/repositories/session.repository";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "hw_session";
const SHORT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const LONG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type RequestMeta = { ipAddress?: string | null; userAgent?: string | null };

/** Creates a database session and returns the raw cookie value. Only the hash is stored. */
export async function createSession(db: Db, p: { userId: string; mfaPassed: boolean; remember: boolean } & RequestMeta): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (p.remember ? LONG_TTL_MS : SHORT_TTL_MS));
  await sessionRepository.create(db, { userId: p.userId, tokenHash: sha256(token), mfaPassed: p.mfaPassed, expiresAt, ipAddress: p.ipAddress, userAgent: p.userAgent });
  return { token, expiresAt };
}

export async function findSession(db: Db, token: string | undefined | null) {
  if (!token) return null;
  const s = await sessionRepository.findLive(db, sha256(token));
  if (!s) return null;
  // Touch at most once a minute to keep writes low.
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) await sessionRepository.touch(db, s.id);
  return s;
}

export async function destroySession(db: Db, token: string | undefined | null) {
  if (!token) return;
  await sessionRepository.deleteByHash(db, sha256(token));
}

export async function markSessionMfaPassed(db: Db, sessionId: string) {
  await sessionRepository.markMfaPassed(db, sessionId);
}
