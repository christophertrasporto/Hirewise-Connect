import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, type RoleKey as DbRoleKey, type AgreementType } from "@prisma/client";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_NAMES, type RoleKey } from "../src/server/policies/permissions";

/**
 * Deterministic foundation seed (Section 12). Safe to re-run: every write is an upsert.
 * Phase 1 extends this with demo agents, clients, shortlists, and placements.
 */
const prisma = new PrismaClient();

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
    const p = await prisma.permission.upsert({
      where: { key },
      create: { key, group: meta.group, description: meta.description },
      update: { group: meta.group, description: meta.description },
    });
    permIds.set(key, p.id);
  }

  // Role → permissions (exact sync: remove anything not in the catalog)
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS) as Array<[RoleKey, readonly string[]]>) {
    const roleId = roleIds.get(role)!;
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: perms.map((p) => permIds.get(p)!) } } });
    for (const p of perms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permIds.get(p)! } },
        create: { roleId, permissionId: permIds.get(p)! },
        update: {},
      });
    }
  }

  // Agreements v1 with LEGAL_PLACEHOLDER bodies
  for (const a of AGREEMENTS) {
    const body = [`# ${a.title}`, "", "> LEGAL_PLACEHOLDER — replace with counsel-approved text before launch.", "", ...a.covers.map((c, i) => `## ${i + 1}. ${c}\n\nLEGAL_PLACEHOLDER`)].join("\n");
    await prisma.agreement.upsert({
      where: { type_version: { type: a.type, version: 1 } },
      create: { type: a.type, version: 1, title: a.title, bodyMarkdown: body, bodyChecksum: checksum(body), effectiveFrom: new Date("2026-01-01"), isActive: true, requiredForRole: (a.requiredForRole as DbRoleKey | null) ?? undefined },
      update: { title: a.title, bodyMarkdown: body, bodyChecksum: checksum(body) },
    });
  }

  // Settings (Section 14 defaults)
  for (const [key, value] of Object.entries(SETTINGS)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
  }

  // Taxonomies
  for (const [name, category] of SKILLS) {
    await prisma.skill.upsert({ where: { name }, create: { name, category }, update: { category } });
  }
  for (const [name, category] of SOFTWARE) {
    await prisma.software.upsert({ where: { name }, create: { name, category }, update: { category } });
  }

  // Staff users (no passwords until Phase 1 wires authentication)
  for (const u of STAFF_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, roleId: roleIds.get(u.role)! },
      update: { roleId: roleIds.get(u.role)! },
    });
  }

  console.log("Seed complete.");
  console.log("Roles:", roleIds.size, "| Permissions:", permIds.size, "| Agreements:", AGREEMENTS.length, "| Skills:", SKILLS.length, "| Software:", SOFTWARE.length);
  console.log("Staff accounts (password login arrives in Phase 1):");
  for (const u of STAFF_USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
