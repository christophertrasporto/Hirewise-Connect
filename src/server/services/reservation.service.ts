import type { PrismaClient, Tx, Db } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { reservationRepository } from "@/server/repositories/reservation.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { settingRepository } from "@/server/repositories/setting.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";

const DAY = 86_400_000;

async function ttlDays(db: Db): Promise<number> {
  const s = await settingRepository.get(db, "reservationTtlDays");
  const n = typeof s?.value === "number" ? s.value : 7;
  return n > 0 ? n : 7;
}

export class AlreadyReservedError extends Error {
  readonly status = 409;
  constructor() {
    super("This candidate is already reserved for another client.");
    this.name = "AlreadyReservedError";
  }
}

/**
 * Section "Candidate reservation": hold a candidate for one client for a configurable period.
 * Staff with reservation.manage may reserve; the selection flow reserves on the client's behalf (system).
 */
export async function reserveForClient(db: Db, actor: Actor, p: { agentProfileId: string; clientId: string; placementId?: string | null; reason?: string | null; system?: boolean; days?: number; /** The Hirewise user who owns the hold; defaults to the actor. */ reservedById?: string | null }) {
  if (!p.system) authorize(actor, "reservation.manage");
  const existing = await reservationRepository.activeForAgent(db, p.agentProfileId);
  if (existing) {
    if (existing.clientId === p.clientId) return existing;
    throw new AlreadyReservedError();
  }
  const days = p.days ?? (await ttlDays(db));
  const expiresAt = new Date(Date.now() + days * DAY);
  const res = await reservationRepository.create(db, { agentProfileId: p.agentProfileId, clientId: p.clientId, placementId: p.placementId ?? null, reservedById: p.reservedById ?? actor.userId, reason: p.reason ?? null, expiresAt });
  await agentRepository.setAvailability(db, p.agentProfileId, "RESERVED", { setById: actor.userId === "system" ? null : actor.userId, reason: p.reason ?? "Reserved" });
  await audit(db, { actor, action: "RESERVATION_CREATED", entityType: "Reservation", entityId: res.id, newValue: { agentProfileId: p.agentProfileId, clientId: p.clientId, expiresAt: expiresAt.toISOString() } });
  return res;
}

export async function extendReservation(db: PrismaClient, actor: Actor, id: string, days?: number) {
  authorize(actor, "reservation.manage");
  const r = await reservationRepository.findById(db, id);
  if (!r || !["ACTIVE", "EXTENDED"].includes(r.status)) throw new NotFoundError();
  const add = days ?? (await ttlDays(db));
  const expiresAt = new Date(Math.max(r.expiresAt.getTime(), Date.now()) + add * DAY);
  await db.$transaction(async (tx) => {
    await reservationRepository.extend(tx, id, expiresAt);
    await audit(tx, { actor, action: "RESERVATION_EXTENDED", entityType: "Reservation", entityId: id, previousValue: { expiresAt: r.expiresAt.toISOString() }, newValue: { expiresAt: expiresAt.toISOString() } });
  });
}

export async function releaseReservation(db: PrismaClient, actor: Actor, id: string, reason?: string) {
  authorize(actor, "reservation.manage");
  const r = await reservationRepository.findById(db, id);
  if (!r || !["ACTIVE", "EXTENDED"].includes(r.status)) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    await reservationRepository.setStatus(tx, id, "RELEASED");
    const before = await reservationRepository.availabilityBefore(tx, r.agentProfileId, r.startsAt);
    if (r.agentProfile.availabilityStatus === "RESERVED") await agentRepository.setAvailability(tx, r.agentProfileId, before, { setById: actor.userId, reason: reason ?? "Reservation released" });
    await audit(tx, { actor, action: "RESERVATION_RELEASED", entityType: "Reservation", entityId: id, reason });
  });
}

export async function listReservations(db: PrismaClient, actor: Actor) {
  authorize(actor, "reservation.manage");
  const rows = await reservationRepository.listActive(db);
  return rows.map((r) => ({ id: r.id, status: r.status, expiresAt: r.expiresAt, startsAt: r.startsAt, extensions: r.extensions, reason: r.reason, agent: r.agentProfile, client: r.client, reservedBy: r.reservedBy.email }));
}

/**
 * Job: expire reservations past their TTL and restore the agent's previous availability
 * (Section 5.8). `now` is injectable so the behaviour can be tested with a fake clock.
 */
export async function expireReservations(db: PrismaClient, now = new Date()): Promise<number> {
  const due = await reservationRepository.due(db, now);
  const system: Actor = { userId: "system", role: "SUPER_ADMIN", permissions: new Set() };
  for (const r of due) {
    await db.$transaction(async (tx: Tx) => {
      await reservationRepository.setStatus(tx, r.id, "EXPIRED");
      const current = await agentRepository.availabilityOf(tx, r.agentProfileId);
      if (current === "RESERVED") {
        const before = await reservationRepository.availabilityBefore(tx, r.agentProfileId, r.startsAt);
        await agentRepository.setAvailability(tx, r.agentProfileId, before, { setById: null, reason: "Reservation expired" });
      }
      await audit(tx, { actor: system, action: "RESERVATION_EXPIRED", entityType: "Reservation", entityId: r.id, newValue: { expiredAt: now.toISOString() } });
      await publishEvent(tx, "RESERVATION_EXPIRED", { reservationId: r.id, reservedById: r.reservedById, displayName: r.agentProfile.displayName, companyName: r.client.companyName });
    });
  }
  return due.length;
}

/** Job: warn the reserving rep 24 hours before expiry. */
export async function notifyExpiringReservations(db: PrismaClient, now = new Date()): Promise<number> {
  const rows = await reservationRepository.expiringWithin(db, now, new Date(now.getTime() + DAY));
  for (const r of rows) {
    await publishEvent(db, "RESERVATION_EXPIRING", { reservationId: r.id, reservedById: r.reservedById, displayName: r.agentProfile.displayName, companyName: r.client.companyName, expiresAt: r.expiresAt.toISOString() });
  }
  return rows.length;
}
