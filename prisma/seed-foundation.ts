import { createHash } from "node:crypto";
import type { PrismaClient, RoleKey as DbRoleKey, AgreementType } from "@prisma/client";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_NAMES, type RoleKey } from "../src/server/policies/permissions";
import { DEFAULT_REQUIREMENTS } from "../src/server/services/verification.service";

/**
 * Foundation seed (Section 12): reference data every environment needs and no user accounts.
 * Roles, permissions, agreement placeholders, settings, taxonomies, Academy result labels and
 * certification templates, the verification ladder, and deposit policies. Every write is an upsert,
 * so it is safe to re-run, including against production.
 */
export type SeedScope = "foundation" | "demo";

/** `--foundation` (or SEED_SCOPE=foundation) seeds reference data only; the default also creates demo accounts. */
export function resolveSeedScope(argv: readonly string[], env: Record<string, string | undefined>): SeedScope {
  return argv.includes("--foundation") || env.SEED_SCOPE === "foundation" ? "foundation" : "demo";
}

/**
 * Demo accounts share a published password, so they must never land in a production database.
 * Refuses when NODE_ENV is production or DATABASE_URL points at a Supabase host, unless ALLOW_DEMO_SEED=1.
 */
export function assertDemoSeedAllowed(env: Record<string, string | undefined>): void {
  if (env.ALLOW_DEMO_SEED === "1") return;
  const url = env.DATABASE_URL ?? "";
  if (env.NODE_ENV === "production" || /supabase\.(com|co)/i.test(url)) {
    throw new Error(
      "Refusing to seed demo accounts into what looks like a production database. " +
        "Use `npm run db:seed:foundation` for reference data, then `npm run bootstrap:admin -- --email <you>` for the first Super Admin. " +
        "Set ALLOW_DEMO_SEED=1 to override deliberately.",
    );
  }
}

export const AGREEMENTS: Array<{ type: AgreementType; title: string; requiredForRole: RoleKey | null; covers: string[] }> = [
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

export const SETTINGS: Record<string, unknown> = {
  reservationTtlDays: 7,
  hoursPerMonthDefault: 173,
  defaultClientCurrency: "USD",
  identityDisclosureLevel: "DISPLAY_NAME",
  allowFreeMailClients: false,
  autoAssignAccountManager: false,
  marketplaceAccess: "GATED",
  matchWeights: { skills: 30, industry: 10, experienceLevel: 10, certifications: 15, timezone: 15, budget: 10, assessment: 10 },
  retentionDays: 730,
  profileViewBurstPerHour: 60,
  shortlistChurnPerDay: 12,
};

export const SKILLS: Array<[string, string]> = [
  ["Cold Calling", "Sales"], ["Appointment Setting", "Sales"], ["Lead Generation", "Sales"], ["Outbound Sales", "Sales"], ["Inbound Sales", "Sales"],
  ["Customer Service", "Support"], ["Technical Support", "Support"], ["Live Chat Support", "Support"], ["Email Support", "Support"],
  ["Executive Assistance", "Admin"], ["Calendar Management", "Admin"], ["Inbox Management", "Admin"], ["Data Entry", "Admin"], ["Research", "Admin"],
  ["Bookkeeping", "Finance"], ["Invoicing", "Finance"],
  ["Social Media Management", "Marketing"], ["Content Writing", "Marketing"], ["Graphic Design", "Marketing"],
  ["CRM Management", "Tools"], ["Real Estate Transaction Coordination", "Industry"], ["Medical Scheduling", "Industry"],
];

export const SOFTWARE: Array<[string, string]> = [
  ["HubSpot", "CRM"], ["Salesforce", "CRM"], ["Zoho CRM", "CRM"], ["GoHighLevel", "CRM"], ["Pipedrive", "CRM"],
  ["Zendesk", "Support"], ["Freshdesk", "Support"], ["Intercom", "Support"],
  ["Google Workspace", "Productivity"], ["Microsoft 365", "Productivity"], ["Slack", "Communication"], ["Zoom", "Communication"],
  ["RingCentral", "Dialer"], ["Mojo Dialer", "Dialer"], ["Aircall", "Dialer"],
  ["QuickBooks", "Finance"], ["Xero", "Finance"], ["Canva", "Design"], ["Notion", "Productivity"], ["Asana", "Productivity"],
];

export function checksum(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

export type FoundationIds = {
  roleIds: Map<RoleKey, string>;
  permIds: Map<string, string>;
  agreementIds: Record<string, string>;
  skillIds: Map<string, string>;
  softwareIds: Map<string, string>;
  labelIds: Map<string, string>;
  templateIds: Map<string, string>;
};

export async function seedFoundation(prisma: PrismaClient): Promise<FoundationIds> {
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
    const body = a.type === "PLACEMENT_SERVICE_AGREEMENT"
      ? [`# ${a.title}`, "", "> LEGAL_PLACEHOLDER — replace with counsel-approved text before launch. Placeholders in double braces are filled per placement.", "", "## 1. Parties", "", "This agreement is between Hirewise Virtual Assistance Services (\"Hirewise\") and {{companyName}} (\"Client\").", "", "## 2. Position and schedule", "", "Hirewise places {{agentName}} as {{positionTitle}}, working {{schedule}}, starting {{startDate}}.", "", "## 3. Client billing rate", "", "The Client pays Hirewise {{billingRate}}. The talent's compensation is set by Hirewise and is not part of this agreement. LEGAL_PLACEHOLDER", "", "## 4. Deposit", "", "A deposit of {{deposit}} is invoiced at approval and is due before deployment. LEGAL_PLACEHOLDER", "", "## 5. Pausing, replacement, termination", "", "LEGAL_PLACEHOLDER", "", "## 6. Invoicing and payment", "", "LEGAL_PLACEHOLDER", "", "## 7. Non-circumvention", "", "The Client engages the talent only through Hirewise for the duration set out in the Non-Circumvention Policy. LEGAL_PLACEHOLDER"].join("\n")
      : [`# ${a.title}`, "", "> LEGAL_PLACEHOLDER — replace with counsel-approved text before launch.", "", ...a.covers.map((c, i) => `## ${i + 1}. ${c}\n\nLEGAL_PLACEHOLDER`)].join("\n");
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

  // Academy foundation: result labels, certification templates, verification ladder
  const LABELS: Array<[string, string, number]> = [["NEEDS_IMPROVEMENT", "Needs improvement", 0], ["PASSED", "Passed", 1], ["GOOD", "Good", 2], ["EXCELLENT", "Excellent", 3], ["OUTSTANDING", "Outstanding", 4]];
  const labelIds = new Map<string, string>();
  for (const [key, label, rank] of LABELS) {
    const l = await prisma.assessmentResultLabel.upsert({ where: { key }, create: { key, label, rank }, update: { label, rank } });
    labelIds.set(key, l.id);
  }
  const TEMPLATES = [
    { name: "Hirewise Certified Appointment Setter", description: "Outbound calling, objection handling, and CRM discipline verified by exam and a coach role-play.", validityMonths: 24, badgeKey: "setter", requiresCompletion: true, minExamScore: 70, requiresCoachReview: true, minResultLabelRank: 2 },
    { name: "Hirewise Certified Customer Service Representative", description: "Tier-1 support fundamentals, tone, and escalation verified by exam.", validityMonths: 24, badgeKey: "csr", requiresCompletion: true, minExamScore: 75, requiresCoachReview: false, minResultLabelRank: null },
    { name: "Hirewise Certified Executive Assistant", description: "Calendar, inbox, and founder support verified by exam and coach practical.", validityMonths: null, badgeKey: "ea", requiresCompletion: true, minExamScore: 70, requiresCoachReview: true, minResultLabelRank: 2 },
  ];
  const templateIds = new Map<string, string>();
  for (const t of TEMPLATES) {
    const row = await prisma.certificationTemplate.upsert({ where: { name: t.name }, create: t, update: { description: t.description, validityMonths: t.validityMonths, badgeKey: t.badgeKey, minExamScore: t.minExamScore, requiresCoachReview: t.requiresCoachReview, minResultLabelRank: t.minResultLabelRank } });
    templateIds.set(t.badgeKey, row.id);
  }
  for (const [level, rules] of Object.entries(DEFAULT_REQUIREMENTS)) {
    await prisma.verificationRequirement.upsert({ where: { level: level as never }, create: { level: level as never, rules }, update: {} });
  }

  // Deposit policies
  const POLICIES = [
    { name: "One month (default)", type: "ONE_MONTH" as const, value: 0, isDefault: true },
    { name: "Two weeks", type: "TWO_WEEKS" as const, value: 0, isDefault: false },
    { name: "Fixed USD 500", type: "FIXED" as const, value: 50_000, currency: "USD", isDefault: false },
    { name: "Custom (set at approval)", type: "CUSTOM" as const, value: 0, isDefault: false },
  ];
  for (const p of POLICIES) await prisma.depositPolicy.upsert({ where: { name: p.name }, create: { name: p.name, type: p.type, value: p.value, currency: "currency" in p ? p.currency : undefined, isDefault: p.isDefault }, update: { type: p.type, value: p.value, isDefault: p.isDefault } });

  return { roleIds, permIds, agreementIds, skillIds, softwareIds, labelIds, templateIds };
}
