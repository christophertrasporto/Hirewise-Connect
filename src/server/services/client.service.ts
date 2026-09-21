import { z } from "zod";
import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import type { RequestMeta } from "@/server/auth/session";
import { authorize } from "@/server/policies/authorize";
import { scopedClientId } from "@/server/policies/ownership";
import { clientRepository } from "@/server/repositories/client.repository";
import { userRepository } from "@/server/repositories/user.repository";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { emailSchema, requestEmailVerification } from "./auth.service";
import { createSession } from "@/server/auth/session";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { rateLimit } from "@/server/auth/rate-limit";
import { getSetting } from "./setting.service";
import { toClientSelfView, toClientStaffView } from "@/server/views/client.views";
import { NotFoundError } from "@/server/policies/authorize";

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "mail.com", "yandex.com", "gmx.com"]);

export const clientRegistrationSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is required.").max(120),
  contactName: z.string().trim().min(2, "Contact person is required.").max(120),
  position: z.string().trim().min(2, "Position is required.").max(120),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  industry: z.string().trim().min(2, "Industry is required.").max(80),
  website: z.string().trim().url("Enter a full URL, including https://").optional().or(z.literal("")),
  country: z.string().trim().min(2, "Country is required.").max(80),
  timezone: z.string().trim().min(2, "Timezone is required.").max(80),
  servicesNeeded: z.array(z.string().trim().min(1)).min(1, "Select at least one service."),
  agentsRequired: z.coerce.number().int().min(1, "At least one agent.").max(500),
  preferredSchedule: z.string().trim().max(200).optional().or(z.literal("")),
  expectedStartDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type ClientRegistrationInput = z.infer<typeof clientRegistrationSchema>;

export class RegistrationError extends Error {
  readonly status = 400;
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

/**
 * Section 8.1. Creates User (CLIENT), Client (PENDING_REVIEW), primary contact,
 * onboarding record; emits CLIENT_REGISTERED; starts a session and sends the
 * verification email. Agreements are gated on the next request (INV-I2).
 */
export async function registerClient(db: PrismaClient, input: ClientRegistrationInput, meta: RequestMeta) {
  rateLimit(`register:${meta.ipAddress ?? "unknown"}`, 10, 60 * 60_000);
  const domain = input.email.split("@")[1]?.toLowerCase();
  const allowFree = await getSetting(db, "allowFreeMailClients");
  if (!allowFree && domain && FREE_MAIL.has(domain)) {
    throw new RegistrationError("Please use your business email address.", "email");
  }
  if (await userRepository.findByEmail(db, input.email)) throw new RegistrationError("An account with this email already exists.", "email");

  const passwordHash = await hashPassword(input.password);
  const role = await userRepository.roleIdByKey(db, "CLIENT");

  const { userId, clientId } = await db.$transaction(async (tx) => {
    const user = await userRepository.create(tx, { email: input.email, passwordHash, roleId: role.id });
    const client = await clientRepository.createWithContact(tx, {
      userId: user.id,
      companyName: input.companyName,
      industry: input.industry,
      website: input.website || null,
      country: input.country,
      timezone: input.timezone,
      contact: { name: input.contactName, position: input.position, businessEmail: input.email, phone: input.phone || null },
      onboarding: {
        servicesNeeded: input.servicesNeeded,
        agentsRequired: input.agentsRequired,
        preferredSchedule: input.preferredSchedule || null,
        expectedStartDate: input.expectedStartDate ? new Date(input.expectedStartDate) : null,
        notes: input.notes || null,
      },
    });
    const actor: Actor = { userId: user.id, role: "CLIENT", permissions: new Set(), clientId: client.id };
    await audit(tx, { actor, action: "CLIENT_REGISTERED", entityType: "Client", entityId: client.id, newValue: { companyName: input.companyName, industry: input.industry, country: input.country }, ipAddress: meta.ipAddress ?? undefined });
    await publishEvent(tx, "USER_CREATED", { userId: user.id, role: "CLIENT", email: input.email });
    await publishEvent(tx, "CLIENT_REGISTERED", { clientId: client.id, userId: user.id, companyName: input.companyName, email: input.email });
    return { userId: user.id, clientId: client.id };
  });

  await requestEmailVerification(db, { userId, email: input.email, ...meta });
  const session = await createSession(db, { userId, mfaPassed: true, remember: true, ...meta });
  return { userId, clientId, ...session };
}

export async function getOwnClient(db: PrismaClient, actor: Actor) {
  const id = scopedClientId(actor, undefined, "client.read");
  const c = await clientRepository.findById(db, id);
  if (!c) throw new NotFoundError();
  return toClientSelfView(c);
}

export async function listClientsForStaff(db: PrismaClient, actor: Actor, status?: "PENDING_REVIEW" | "ACTIVE" | "SUSPENDED") {
  authorize(actor, "client.read");
  const rows = await clientRepository.listByStatus(db, status);
  return rows.map(toClientStaffView);
}

export async function getClientForStaff(db: PrismaClient, actor: Actor, clientId: string) {
  authorize(actor, "client.read");
  const c = await clientRepository.findById(db, clientId);
  if (!c) throw new NotFoundError();
  return toClientStaffView(c);
}

/** Sales/Admin review → ACTIVE. Assigns the reviewing rep as account manager when none is set. */
export async function activateClient(db: PrismaClient, actor: Actor, clientId: string, opts: { accountManagerUserId?: string | null; reason?: string } = {}) {
  authorize(actor, "client.manage");
  const c = await clientRepository.findById(db, clientId);
  if (!c) throw new NotFoundError();
  if (c.status === "ACTIVE") return;
  const manager = opts.accountManagerUserId ?? c.accountManagerUserId ?? (actor.role === "SALES" ? actor.userId : null);
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  await db.$transaction(async (tx) => {
    await clientRepository.setStatus(tx, clientId, "ACTIVE");
    if (manager && manager !== c.accountManagerUserId) {
      await clientRepository.setAccountManager(tx, clientId, manager);
      await audit(tx, { actor, action: "CLIENT_ACCOUNT_MANAGER_ASSIGNED", entityType: "Client", entityId: clientId, previousValue: c.accountManagerUserId, newValue: manager });
    }
    await audit(tx, { actor, action: "CLIENT_ACTIVATED", entityType: "Client", entityId: clientId, previousValue: { status: c.status }, newValue: { status: "ACTIVE" }, reason: opts.reason });
    if (primary?.userId) await publishEvent(tx, "CLIENT_ACTIVATED", { clientId, userId: primary.userId, companyName: c.companyName, email: primary.businessEmail });
  });
}
