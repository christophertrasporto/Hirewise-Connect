import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, type RoleKey as DbRoleKey, type AgreementType } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_NAMES, type RoleKey } from "../src/server/policies/permissions";

/**
 * Deterministic foundation seed (Section 12). Safe to re-run: every write is an upsert.
 * Demo passwords are for local development only.
 */
const prisma = new PrismaClient();

export const DEMO_PASSWORD = "Hirewise!2026";

const AGREEMENTS: Array<{ type: AgreementType; title: string; requiredForRole: RoleKey | null; covers: string[] }> = [
  { type: "CLIENT_TOS", title: "Terms of Service (Client)", requiredForRole: "CLIENT", covers: ["Definitions", "Account eligibility", "Platform use and prohibited conduct", "Suspension and termination", "Limitation of liability", "Governing law"] },
  { type: "CLIENT_PRIVACY", title: "Privacy Policy (Client)", requiredForRole: "CLIENT", covers: ["Data collected", "Use of data", "Sharing with talent", "Retention", "Rights"] },
  { type: "CLIENT_HIRING_TERMS", title: "Hiring Terms", requiredForRole: "CLIENT", covers: ["Representation through Hirewise", "Client billing rates", "Interview process", "Selection, agreement, and deposit", "Deployment and management", "Invoicing"] },
  { type: "CLIENT_NON_CIRCUMVENTION", title: "Non-Circumvention / Direct Hiring Policy (Client)", requiredForRole: "CLIENT", covers: ["Introductions through Hirewise Connect", "Restriction on direct engagement", "Duration", "Placement fee on breach", "Reporting", "Exceptions"] },
  { type: "CLIENT_COMMUNICATION", title: "Communication Policy (Client)", requiredForRole: "CLIENT", covers: ["Communication through Hirewise", "Interview coordination", "Prohibited topics", "Contact information", "Violations"] },
  { type: "AGENT_PLATFORM_TERMS", title: "Platform Terms (Talent)", requiredForRole: "AGENT", covers: ["Definitions", "Eligibility", "Profile content and accuracy", "Media licence for approved recordings", "Suspension", "Governing law"] },
  { type: "AGENT_PRIVACY", title: "Privacy Policy (Talent)", requiredForRole: "AGENT", covers: ["Data collected", "What clients can see", "Recordings and assessments", "Retention", "Rights"] },
  { type: "AGENT_REPRESENTATION", title: "Representation Terms", requiredForRole: "AGENT", covers: ["Hirewise as representative", "Client rate set by Hirewise", "Compensation separate from client rate", "Placement obligations"] },
  { type: "AGENT_NON_CIRCUMVENTION", title: "Non-Circumvention Policy (Talent)", requiredForRole: "AGENT", covers: ["Clients introduced through Hirewise", "Restriction on direct engagement", "Duration", "Consequences", "Reporting"] },
  { type: "AGENT_CLIENT_COMMUNICATION", title: "Client Communication Rules", requiredForRole: "AGENT", covers: ["Communication through Hirewise during hiring", "No rate or compensation discussion with clients", "Contact information", "After deployment"] },
  { type: "AGENT_CONFIDENTIALITY", title: "Confidentiality Requirements", requiredForRole: "AGENT", covers: ["Client information", "Campaign materials", "Data handling", "Duration"] },
  { type: "PLACEMENT_SERVICE_AGREEMENT", title: "Placement Service Agreement", requiredForRole: null, covers: ["Parties", "Position and schedule", "Client billing rate", "Deposit", "Start date", "Pausing, replacement, termination", "Invoicing and payment"] },
];

const SETTINGS: Record<string, unknown> = {
  reservationTtlDays: 7,
  hoursPerMonthDefault: 173,
  defaultClientCurrency: "USD",
  identityDisclosureLevel: "DISPLAY_NAME",
  allowFreeMailClients: false,
  autoAssignAccountManager: false,
  marketplaceAccess: "GATED",
};

const SKILLS: Array<[string, string]> = [
  ["Cold Calling", "Sales"], ["Appointment Setting", "Sales"], ["Lead Generation", "Sales"], ["Outbound Sales", "Sales"], ["Inbound Sales", "Sales"],
  ["Customer Service", "Support"], ["Technical Support", "Support"], ["Live Chat Support", "Support"], ["Email Support", "Support"],
  ["Executive Assistance", "Admin"], ["Calendar Management", "Admin"], ["Inbox Management", "Admin"], ["Data Entry", "Admin"], ["Research", "Admin"],
  ["Bookkeeping", "Finance"], ["Invoicing", "Finance"],
  ["Social Media Management", "Marketing"], ["Content Writing", "Marketing"], ["Graphic Design", "Marketing"],
  ["CRM Management", "Tools"], ["Real Estate Transaction Coordination", "Industry"], ["Medical Scheduling", "Industry"],
];

const SOFTWARE: Array<[string, string]> = [
  ["HubSpot", "CRM"], ["Salesforce", "CRM"], ["Zoho CRM", "CRM"], ["GoHighLevel", "CRM"], ["Pipedrive", "CRM"],
  ["Zendesk", "Support"], ["Freshdesk", "Support"], ["Intercom", "Support"],
  ["Google Workspace", "Productivity"], ["Microsoft 365", "Productivity"], ["Slack", "Communication"], ["Zoom", "Communication"],
  ["RingCentral", "Dialer"], ["Mojo Dialer", "Dialer"], ["Aircall", "Dialer"],
  ["QuickBooks", "Finance"], ["Xero", "Finance"], ["Canva", "Design"], ["Notion", "Productivity"], ["Asana", "Productivity"],
];

const STAFF_USERS: Array<{ email: string; role: RoleKey }> = [
  { email: "owner@hirewise.example", role: "SUPER_ADMIN" },
  { email: "admin@hirewise.example", role: "ADMIN" },
  { email: "sales@hirewise.example", role: "SALES" },
  { email: "recruiter@hirewise.example", role: "RECRUITER" },
  { email: "coach@hirewise.example", role: "COACH" },
  { email: "ops@hirewise.example", role: "OPERATIONS" },
];

function checksum(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

async function main() {
  const passwordHash = await hash(DEMO_PASSWORD, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 });

  // Roles
  const roleIds = new Map<RoleKey, string>();
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) {
    const r = await prisma.role.upsert({
      where: { key: key as DbRoleKey },
      create: { key: key as DbRoleKey, name: ROLE_NAMES[key].name, description: ROLE_NAMES[key].description },
      update: { name: ROLE_NAMES[key].name, description: ROLE_NAMES[key].description },
    });
    roleIds.set(key, r.id);
  }

  // Permissions
  const permIds = new Map<string, string>();
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    const p = await prisma.permission.upsert({ where: { key }, create: { key, group: meta.group, description: meta.description }, update: { group: meta.group, description: meta.description } });
    permIds.set(key, p.id);
  }

  // Role → permissions (exact sync)
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as Array<[RoleKey, readonly string[]]>) {
    const roleId = roleIds.get(role)!;
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: perms.map((p) => permIds.get(p)!) } } });
    for (const p of perms) {
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId, permissionId: permIds.get(p)! } }, create: { roleId, permissionId: permIds.get(p)! }, update: {} });
    }
  }

  // Agreements v1 with LEGAL_PLACEHOLDER bodies
  const agreementIds: Record<string, string> = {};
  for (const a of AGREEMENTS) {
    const body = [`# ${a.title}`, "", "> LEGAL_PLACEHOLDER — replace with counsel-approved text before launch.", "", ...a.covers.map((c, i) => `## ${i + 1}. ${c}\n\nLEGAL_PLACEHOLDER`)].join("\n");
    const row = await prisma.agreement.upsert({
      where: { type_version: { type: a.type, version: 1 } },
      create: { type: a.type, version: 1, title: a.title, bodyMarkdown: body, bodyChecksum: checksum(body), effectiveFrom: new Date("2026-01-01"), isActive: true, requiredForRole: (a.requiredForRole as DbRoleKey | null) ?? undefined },
      update: { title: a.title, bodyMarkdown: body, bodyChecksum: checksum(body) },
    });
    agreementIds[a.type] = row.id;
  }

  // Settings (Section 14 defaults)
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
  }

  // Taxonomies
  const skillIds = new Map<string, string>();
  for (const [name, category] of SKILLS) {
    const s = await prisma.skill.upsert({ where: { name }, create: { name, category }, update: { category } });
    skillIds.set(name, s.id);
  }
  const softwareIds = new Map<string, string>();
  for (const [name, category] of SOFTWARE) {
    const s = await prisma.software.upsert({ where: { name }, create: { name, category }, update: { category } });
    softwareIds.set(name, s.id);
  }

  // Staff users with demo passwords and verified emails
  for (const u of STAFF_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, roleId: roleIds.get(u.role)!, passwordHash, emailVerifiedAt: new Date() },
      update: { roleId: roleIds.get(u.role)!, passwordHash, emailVerifiedAt: new Date() },
    });
  }

  // Demo client: active, verified, agreements accepted
  const clientUser = await prisma.user.upsert({
    where: { email: "hiring@acme-solar.example" },
    create: { email: "hiring@acme-solar.example", roleId: roleIds.get("CLIENT")!, passwordHash, emailVerifiedAt: new Date() },
    update: { passwordHash, emailVerifiedAt: new Date() },
  });
  const existingContact = await prisma.clientContact.findUnique({ where: { userId: clientUser.id } });
  if (existingContact) await prisma.client.update({ where: { id: existingContact.clientId }, data: { status: "ACTIVE" } });
  else
    await prisma.client.create({
        data: {
          companyName: "Acme Solar",
          industry: "Solar / Energy",
          website: "https://acme-solar.example",
          country: "United States",
          timezone: "America/Los_Angeles",
          status: "ACTIVE",
          source: "seed",
          contacts: { create: { userId: clientUser.id, name: "Jordan Lee", position: "Head of Sales", businessEmail: "hiring@acme-solar.example", phone: "+1 555 0100", isPrimary: true } },
          onboarding: { create: { servicesNeeded: ["Appointment Setting", "Cold Calling"], agentsRequired: 3, preferredSchedule: "Mon–Fri 9–5 PST", expectedStartDate: new Date("2026-11-02"), notes: "Residential solar leads, dialer provided." } },
        },
      });
  for (const t of ["CLIENT_TOS", "CLIENT_PRIVACY", "CLIENT_HIRING_TERMS", "CLIENT_NON_CIRCUMVENTION", "CLIENT_COMMUNICATION"]) {
    const exists = await prisma.agreementAcceptance.findFirst({ where: { agreementId: agreementIds[t], userId: clientUser.id, placementId: null } });
    if (!exists) await prisma.agreementAcceptance.create({ data: { agreementId: agreementIds[t], userId: clientUser.id, bodyChecksum: checksum("seed"), ipAddress: "127.0.0.1", userAgent: "seed" } });
  }

  // Demo agent: verified, agreements accepted, profile in DRAFT with most sections done
  const agentUser = await prisma.user.upsert({
    where: { email: "maria@talent.example" },
    create: { email: "maria@talent.example", roleId: roleIds.get("AGENT")!, passwordHash, emailVerifiedAt: new Date() },
    update: { passwordHash, emailVerifiedAt: new Date() },
  });
  let agent = await prisma.agentProfile.findUnique({ where: { userId: agentUser.id } });
  if (!agent) {
    agent = await prisma.agentProfile.create({
      data: {
        userId: agentUser.id,
        displayName: "Maria S.",
        headline: "Cold calling and appointment setting specialist, 4 years in US real estate and solar",
        primaryRole: "Appointment Setter",
        summary: "Four years of outbound work for US clients: residential solar, real estate wholesaling, and roofing. Comfortable with HubSpot, GoHighLevel, and Mojo Dialer. I average 120 dials a day with a 6% set rate on solar campaigns and keep clean notes in the CRM after every call.",
        yearsExperience: 4,
        experienceLevel: "MID",
        locationCity: "Cebu City",
        locationCountry: "Philippines",
        timezone: "Asia/Manila",
        languages: ["English", "Filipino", "Cebuano"],
        workSetup: "REMOTE",
        preferredShift: "US Day (PH Night)",
        equipmentSummary: "Ryzen 5 laptop, 16 GB RAM, Jabra headset, UPS backup",
        internetSummary: "PLDT Fibr 200 Mbps, Globe LTE backup",
        status: "DRAFT",
        availabilityStatus: "UNAVAILABLE",
        privateContact: { create: { fullLegalName: "Maria Santos", personalEmail: "maria@talent.example", phone: "+63 917 000 0000", addressLine: "Cebu City" } },
        skills: { create: [{ skillId: skillIds.get("Cold Calling")!, level: "ADVANCED", yearsUsed: 4 }, { skillId: skillIds.get("Appointment Setting")!, level: "EXPERT", yearsUsed: 4 }, { skillId: skillIds.get("CRM Management")!, level: "INTERMEDIATE", yearsUsed: 3 }, { skillId: skillIds.get("Lead Generation")!, level: "INTERMEDIATE", yearsUsed: 2 }] },
        softwareExperiences: { create: [{ softwareId: softwareIds.get("HubSpot")!, level: "ADVANCED" }, { softwareId: softwareIds.get("GoHighLevel")!, level: "ADVANCED" }, { softwareId: softwareIds.get("Mojo Dialer")!, level: "EXPERT" }] },
        industryExperiences: { create: [{ industry: "Solar / Energy", years: 2 }, { industry: "Real Estate", years: 2 }] },
        experiences: { create: [{ company: "Confidential solar campaign", title: "Appointment Setter", industry: "Solar / Energy", startDate: new Date("2024-03-01"), description: "Outbound residential solar, 120 dials/day, 6% set rate, HubSpot notes.", isCampaign: true, campaignType: "Solar appointment setting" }, { company: "Wholesale RE investor", title: "Cold Caller", industry: "Real Estate", startDate: new Date("2022-01-10"), endDate: new Date("2024-02-15"), description: "Cold calling distressed property lists, qualifying sellers, booking acquisitions calls.", isCampaign: true, campaignType: "Real estate cold calling" }] },
      },
    });
  }
  for (const t of ["AGENT_PLATFORM_TERMS", "AGENT_PRIVACY", "AGENT_REPRESENTATION", "AGENT_NON_CIRCUMVENTION", "AGENT_CLIENT_COMMUNICATION", "AGENT_CONFIDENTIALITY"]) {
    const exists = await prisma.agreementAcceptance.findFirst({ where: { agreementId: agreementIds[t], userId: agentUser.id, placementId: null } });
    if (!exists) await prisma.agreementAcceptance.create({ data: { agreementId: agreementIds[t], userId: agentUser.id, bodyChecksum: checksum("seed"), ipAddress: "127.0.0.1", userAgent: "seed" } });
  }
  await prisma.agentProfile.update({ where: { id: agent.id }, data: { profileCompletion: 55 } });

  console.log("Seed complete.");
  console.log("Roles:", roleIds.size, "| Permissions:", permIds.size, "| Agreements:", AGREEMENTS.length, "| Skills:", SKILLS.length, "| Software:", SOFTWARE.length);
  console.log(`\nDemo accounts (password: ${DEMO_PASSWORD}):`);
  for (const u of STAFF_USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}${u.role === "SUPER_ADMIN" || u.role === "ADMIN" ? "  (MFA setup on first login)" : ""}`);
  console.log(`  ${"CLIENT".padEnd(12)} hiring@acme-solar.example  (active)`);
  console.log(`  ${"AGENT".padEnd(12)} maria@talent.example  (draft profile: add résumé + video, then submit)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
