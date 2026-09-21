import type { Prisma } from "@/server/db/types";

type ClientRecord = Prisma.ClientGetPayload<{ include: { contacts: true; onboarding: true; accountManager: { select: { id: true; email: true } } } }>;

/** The client's own company page. */
export function toClientSelfView(c: ClientRecord) {
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  return {
    id: c.id,
    companyName: c.companyName,
    industry: c.industry,
    website: c.website,
    country: c.country,
    timezone: c.timezone,
    status: c.status,
    createdAt: c.createdAt,
    contact: primary ? { name: primary.name, position: primary.position, businessEmail: primary.businessEmail, phone: primary.phone } : null,
    onboarding: c.onboarding
      ? { servicesNeeded: c.onboarding.servicesNeeded, agentsRequired: c.onboarding.agentsRequired, preferredSchedule: c.onboarding.preferredSchedule, expectedStartDate: c.onboarding.expectedStartDate, notes: c.onboarding.notes }
      : null,
    accountManagerAssigned: !!c.accountManagerUserId,
  };
}

/** Sales and admin list row: includes contact details because staff coordinate with clients. */
export function toClientStaffView(c: ClientRecord) {
  const primary = c.contacts.find((x) => x.isPrimary) ?? c.contacts[0];
  return {
    id: c.id,
    companyName: c.companyName,
    industry: c.industry,
    website: c.website,
    country: c.country,
    timezone: c.timezone,
    status: c.status,
    createdAt: c.createdAt,
    accountManager: c.accountManager ? { id: c.accountManager.id, email: c.accountManager.email } : null,
    contact: primary ? { name: primary.name, position: primary.position, businessEmail: primary.businessEmail, phone: primary.phone } : null,
    onboarding: c.onboarding
      ? { servicesNeeded: c.onboarding.servicesNeeded, agentsRequired: c.onboarding.agentsRequired, preferredSchedule: c.onboarding.preferredSchedule, expectedStartDate: c.onboarding.expectedStartDate, notes: c.onboarding.notes }
      : null,
  };
}
