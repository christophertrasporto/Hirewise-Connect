import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, type RoleKey as DbRoleKey, type AgreementType } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_NAMES, type RoleKey } from "../src/server/policies/permissions";
import { DEFAULT_REQUIREMENTS } from "../src/server/services/verification.service";

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

  // Approved, searchable agents for the marketplace demo and the e2e isolation tests.
  const salesUser = await prisma.user.findUniqueOrThrow({ where: { email: "sales@hirewise.example" } });
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: "admin@hirewise.example" } });
  const approvedAgents = [
    { email: "jose@talent.example", displayName: "Jose R.", fullLegalName: "Jose Ramos", headline: "Customer service and technical support lead, 6 years with US SaaS and telecom accounts", primaryRole: "Customer Service Representative", years: 6, level: "SENIOR" as const, availability: "AVAILABLE" as const, tz: "Asia/Manila", skills: [["Customer Service", "EXPERT"], ["Technical Support", "ADVANCED"], ["Live Chat Support", "ADVANCED"], ["Email Support", "EXPERT"]] as Array<[string, "BASIC" | "INTERMEDIATE" | "ADVANCED" | "EXPERT"]>, software: ["Zendesk", "Intercom", "Slack"], industries: [["SaaS / Technology", 4], ["Logistics", 2]] as Array<[string, number]>, summary: "Six years handling tier-1 and tier-2 support for US SaaS and telecom clients. Led a team of eight on a 24/7 queue, wrote the macro library, and kept CSAT above 92% for three years. Comfortable with Zendesk, Intercom, and escalation runbooks.", verification: "HIREWISE_CERTIFIED" as const },
    { email: "ana@talent.example", displayName: "Ana L.", fullLegalName: "Ana Lim", headline: "Executive assistant and inbox manager for founders, 3 years, Australian and US clients", primaryRole: "Executive Assistant", years: 3, level: "MID" as const, availability: "AVAILABLE_SOON" as const, tz: "Asia/Manila", skills: [["Executive Assistance", "ADVANCED"], ["Calendar Management", "EXPERT"], ["Inbox Management", "EXPERT"], ["Research", "INTERMEDIATE"]] as Array<[string, "BASIC" | "INTERMEDIATE" | "ADVANCED" | "EXPERT"]>, software: ["Google Workspace", "Notion", "Asana"], industries: [["Marketing Agency", 2], ["E-commerce", 1]] as Array<[string, number]>, summary: "Three years supporting two founders across Sydney and Los Angeles: calendar, travel, inbox triage, board-meeting prep, and light bookkeeping in Xero. I keep a daily brief and a running decisions log so nothing falls through.", verification: "PROFILE_VERIFIED" as const },
    { email: "carlo@talent.example", displayName: "Carlo D.", fullLegalName: "Carlo Dizon", headline: "Cold caller and SDR for US real estate and roofing campaigns, 5 years", primaryRole: "Cold Caller", years: 5, level: "SENIOR" as const, availability: "PLACED" as const, tz: "Asia/Manila", skills: [["Cold Calling", "EXPERT"], ["Appointment Setting", "ADVANCED"], ["Lead Generation", "ADVANCED"]] as Array<[string, "BASIC" | "INTERMEDIATE" | "ADVANCED" | "EXPERT"]>, software: ["Mojo Dialer", "GoHighLevel"], industries: [["Real Estate", 3], ["Construction", 2]] as Array<[string, number]>, summary: "Five years of outbound for US real estate investors and roofing companies. 150+ dials a day, live transfers and appointment setting, with clean CRM notes. Currently placed with a Hirewise client.", verification: "DEPLOYMENT_READY" as const },
  ];
  for (const a of approvedAgents) {
    const u = await prisma.user.upsert({ where: { email: a.email }, create: { email: a.email, roleId: roleIds.get("AGENT")!, passwordHash, emailVerifiedAt: new Date() }, update: { passwordHash, emailVerifiedAt: new Date() } });
    for (const t of ["AGENT_PLATFORM_TERMS", "AGENT_PRIVACY", "AGENT_REPRESENTATION", "AGENT_NON_CIRCUMVENTION", "AGENT_CLIENT_COMMUNICATION", "AGENT_CONFIDENTIALITY"]) {
      const exists = await prisma.agreementAcceptance.findFirst({ where: { agreementId: agreementIds[t], userId: u.id, placementId: null } });
      if (!exists) await prisma.agreementAcceptance.create({ data: { agreementId: agreementIds[t], userId: u.id, bodyChecksum: checksum("seed"), ipAddress: "127.0.0.1", userAgent: "seed" } });
    }
    const existing = await prisma.agentProfile.findUnique({ where: { userId: u.id } });
    if (existing) continue;
    await prisma.agentProfile.create({
      data: {
        userId: u.id, displayName: a.displayName, headline: a.headline, primaryRole: a.primaryRole, summary: a.summary, yearsExperience: a.years, experienceLevel: a.level,
        locationCity: "Manila", locationCountry: "Philippines", timezone: a.tz, languages: ["English", "Filipino"], workSetup: "REMOTE", preferredShift: "US Day (PH Night)",
        status: "APPROVED", verificationLevel: a.verification, availabilityStatus: a.availability, availableFrom: a.availability === "AVAILABLE_SOON" ? new Date(Date.now() + 14 * 86_400_000) : undefined,
        profileCompletion: 85, submittedAt: new Date(Date.now() - 5 * 86_400_000), approvedAt: new Date(Date.now() - 2 * 86_400_000), approvedById: adminUser.id,
        privateContact: { create: { fullLegalName: a.fullLegalName, personalEmail: a.email, phone: "+63 917 111 1111", resumeKey: `agents/seed/resume/${a.displayName}.pdf` } },
        skills: { create: a.skills.map(([name, level]) => ({ skillId: skillIds.get(name)!, level, yearsUsed: 2 })) },
        softwareExperiences: { create: a.software.map((name) => ({ softwareId: softwareIds.get(name)!, level: "ADVANCED" })) },
        industryExperiences: { create: a.industries.map(([industry, years]) => ({ industry, years })) },
        experiences: { create: [{ title: a.primaryRole, company: "Confidential campaign", industry: a.industries[0][0], startDate: new Date("2022-01-01"), description: a.headline, isCampaign: a.primaryRole !== "Executive Assistant", campaignType: a.primaryRole !== "Executive Assistant" ? a.primaryRole : undefined }] },
        availabilityHistory: { create: { status: a.availability, setById: adminUser.id, reason: "Seed" } },
      },
    });
  }

  // Acme is managed by the Sales demo user; a second active client (Beta Corp) exists for isolation tests.
  const acmeContact = await prisma.clientContact.findUnique({ where: { userId: clientUser.id } });
  if (acmeContact) await prisma.client.update({ where: { id: acmeContact.clientId }, data: { accountManagerUserId: salesUser.id } });
  const betaUser = await prisma.user.upsert({ where: { email: "ops@beta-corp.example" }, create: { email: "ops@beta-corp.example", roleId: roleIds.get("CLIENT")!, passwordHash, emailVerifiedAt: new Date() }, update: { passwordHash, emailVerifiedAt: new Date() } });
  const betaContact = await prisma.clientContact.findUnique({ where: { userId: betaUser.id } });
  const beta = betaContact
    ? await prisma.client.findUniqueOrThrow({ where: { id: betaContact.clientId } })
    : await prisma.client.create({ data: { companyName: "Beta Corp", industry: "SaaS / Technology", country: "Australia", timezone: "Australia/Sydney", status: "ACTIVE", source: "seed", contacts: { create: { userId: betaUser.id, name: "Sam Ng", position: "COO", businessEmail: "ops@beta-corp.example", isPrimary: true } }, onboarding: { create: { servicesNeeded: ["Customer Service"], agentsRequired: 2 } } } });
  for (const t of ["CLIENT_TOS", "CLIENT_PRIVACY", "CLIENT_HIRING_TERMS", "CLIENT_NON_CIRCUMVENTION", "CLIENT_COMMUNICATION"]) {
    const exists = await prisma.agreementAcceptance.findFirst({ where: { agreementId: agreementIds[t], userId: betaUser.id, placementId: null } });
    if (!exists) await prisma.agreementAcceptance.create({ data: { agreementId: agreementIds[t], userId: betaUser.id, bodyChecksum: checksum("seed"), ipAddress: "127.0.0.1", userAgent: "seed" } });
  }
  const jose = await prisma.agentProfile.findFirstOrThrow({ where: { displayName: "Jose R." } });
  let betaList = await prisma.shortlist.findFirst({ where: { clientId: beta.id, isDefault: true } });
  if (!betaList) betaList = await prisma.shortlist.create({ data: { clientId: beta.id, createdById: betaUser.id, isDefault: true } });
  if (!(await prisma.shortlistCandidate.findFirst({ where: { shortlistId: betaList.id, agentProfileId: jose.id, removedAt: null } }))) {
    await prisma.shortlistCandidate.create({ data: { shortlistId: betaList.id, agentProfileId: jose.id, addedById: betaUser.id, note: "Strong Zendesk background" } });
  }


  // Phase 3 — Academy: result labels, certification templates, verification ladder, demo courses with exams.
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

  const coachUser = await prisma.user.findUniqueOrThrow({ where: { email: "coach@hirewise.example" } });
  const COURSES = [
    {
      code: "appointment-setting-fundamentals", title: "Appointment Setting Fundamentals", category: "Sales and Appointment Setting", priceCents: 0, passingScore: 70, requiresCoachReview: true, template: "setter", status: "PUBLISHED" as const,
      description: "The Hirewise method for outbound appointment setting: openers, qualification, objection handling, and clean CRM notes. Free for all approved talent.",
      syllabus: "Module 1 — The first 10 seconds: openers that earn attention\nModule 2 — Qualifying without interrogating\nModule 3 — Objection handling: price, timing, trust\nModule 4 — Booking the appointment and confirming\nModule 5 — CRM hygiene and hand-off notes\n\nComplete the exam (70% to pass). Your coach then runs a short role-play before certification.",
      exam: { title: "Appointment Setting Fundamentals — final exam", instructions: "Single answer per question. 20 minutes. Two attempts.", timeLimitMin: 20, maxAttempts: 2, questions: [
        { prompt: "What is the primary goal of the first ten seconds of an outbound call?", options: ["Explain every feature of the offer", "Earn permission to continue the conversation", "Ask for the appointment immediately", "Confirm the prospect's address"], correctIndex: 1, points: 1, explanation: "The opener buys attention; the pitch comes later." },
        { prompt: "A prospect says 'I'm busy right now.' The best response is:", options: ["Hang up politely", "Keep talking faster", "Acknowledge, ask for a specific better time, and confirm it", "Say the offer expires today"], correctIndex: 2, points: 1 },
        { prompt: "Which qualification approach keeps the prospect engaged?", options: ["A rapid checklist of yes/no questions", "Open questions tied to their situation", "Reading the script word for word", "Skipping qualification to save time"], correctIndex: 1, points: 1 },
        { prompt: "After booking, the setter should:", options: ["Log the appointment, time zone, and context in the CRM immediately", "Wait until end of shift to update the CRM", "Send the prospect the client's personal number", "Discuss pricing in detail"], correctIndex: 0, points: 2, explanation: "Hand-off quality decides whether the closer shows up prepared." },
        { prompt: "Which is a Hirewise communication rule during the hiring process?", options: ["Share your own contact details with clients", "Discuss your compensation with the client", "Keep coordination inside Hirewise Connect", "Negotiate rates directly"], correctIndex: 2, points: 1 },
      ] },
    },
    {
      code: "customer-service-excellence", title: "Customer Service Excellence", category: "Customer Service", priceCents: 4900, passingScore: 75, requiresCoachReview: false, template: "csr", status: "PUBLISHED" as const,
      description: "Tier-1 support fundamentals for US and Australian accounts: tone, macros, escalation, and CSAT recovery. USD 49.00, certification on passing the exam.",
      syllabus: "Module 1 — Tone and empathy statements\nModule 2 — Ticket triage and macros\nModule 3 — Escalation criteria and hand-offs\nModule 4 — CSAT recovery and follow-up\n\nExam: 75% to pass. Certification is issued automatically on passing.",
      exam: { title: "Customer Service Excellence — final exam", instructions: "Single answer per question. Untimed. Two attempts.", timeLimitMin: null, maxAttempts: 2, questions: [
        { prompt: "A customer writes an angry email about a delayed order. Your first sentence should:", options: ["Explain the carrier's policy", "Acknowledge the frustration and take ownership", "Ask for their order number only", "Offer a discount immediately"], correctIndex: 1, points: 1 },
        { prompt: "When should a ticket be escalated?", options: ["Whenever the customer uses capital letters", "When resolution needs access or authority you do not have", "Never; tier-1 resolves everything", "Only on Fridays"], correctIndex: 1, points: 1 },
        { prompt: "A macro should be:", options: ["Sent unchanged every time", "Personalised with the customer's details before sending", "Used only by supervisors", "Avoided entirely"], correctIndex: 1, points: 1 },
        { prompt: "The best way to recover a low CSAT score is:", options: ["Ignore it", "Follow up personally, confirm the fix, and invite feedback", "Close the ticket quickly", "Blame another department"], correctIndex: 1, points: 1 },
      ] },
    },
    {
      code: "executive-assistant-playbook", title: "Executive Assistant Playbook", category: "Executive Assistance", priceCents: 9900, passingScore: 70, requiresCoachReview: true, template: "ea", status: "DRAFT" as const,
      description: "Calendar architecture, inbox zero for founders, meeting prep, and the daily brief. USD 99.00. In draft: the coach is still building the exam.",
      syllabus: "Module 1 — Calendar architecture\nModule 2 — Inbox triage rules\nModule 3 — Meeting prep and the daily brief",
      exam: null,
    },
  ];
  for (const c of COURSES) {
    let course = await prisma.academyCourse.findUnique({ where: { code: c.code } });
    if (!course) {
      course = await prisma.academyCourse.create({ data: { code: c.code, title: c.title, category: c.category, description: c.description, syllabus: c.syllabus, ownerCoachUserId: coachUser.id, priceCents: c.priceCents, currency: "USD", passingScore: c.passingScore, requiresCoachReview: c.requiresCoachReview, certificationTemplateId: templateIds.get(c.template), status: c.status, publishedAt: c.status === "PUBLISHED" ? new Date(Date.now() - 10 * 86_400_000) : undefined, publishedById: c.status === "PUBLISHED" ? adminUser.id : undefined, coaches: { create: { coachUserId: coachUser.id } } } });
      if (c.exam) {
        await prisma.exam.create({ data: { courseId: course.id, title: c.exam.title, instructions: c.exam.instructions, timeLimitMin: c.exam.timeLimitMin ?? undefined, maxAttempts: c.exam.maxAttempts, status: c.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", questions: { create: c.exam.questions.map((q, i) => ({ order: i + 1, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, points: q.points, explanation: "explanation" in q ? q.explanation : undefined })) } } });
      }
    }
  }

  // Jose completed the free course, was assessed "Excellent", and holds the Appointment Setter certification.
  const setterCourse = await prisma.academyCourse.findUniqueOrThrow({ where: { code: "appointment-setting-fundamentals" } });
  let joseEnrollment = await prisma.courseEnrollment.findUnique({ where: { courseId_agentProfileId: { courseId: setterCourse.id, agentProfileId: jose.id } } });
  if (!joseEnrollment) {
    joseEnrollment = await prisma.courseEnrollment.create({ data: { courseId: setterCourse.id, agentProfileId: jose.id, status: "COMPLETED", paymentStatus: "NOT_REQUIRED", priceCents: 0, enrolledAt: new Date(Date.now() - 8 * 86_400_000), completion: { create: { examScore: 90, completedAt: new Date(Date.now() - 6 * 86_400_000) } } } });
    const assessment = await prisma.assessment.create({ data: { courseId: setterCourse.id, agentProfileId: jose.id, coachUserId: coachUser.id, type: "ROLEPLAY", examScore: 90, roleplayScore: 88, communicationScore: 92, strengths: "Warm opener, natural pacing, confident close.", areasForImprovement: "Tighten the qualification questions when the prospect rambles.", comments: "Ready for solar and roofing campaigns.", resultLabelId: labelIds.get("EXCELLENT"), certificationRecommended: true, status: "FINAL", assessedAt: new Date(Date.now() - 5 * 86_400_000) } });
    await prisma.certification.create({ data: { agentProfileId: jose.id, templateId: templateIds.get("setter")!, origin: "ACADEMY", assessmentId: assessment.id, courseId: setterCourse.id, status: "APPROVED", approvedById: adminUser.id, approvedAt: new Date(Date.now() - 5 * 86_400_000), issuedAt: new Date(Date.now() - 5 * 86_400_000), expiresAt: new Date(Date.now() + 730 * 86_400_000) } });
    await prisma.coachEvaluation.create({ data: { agentProfileId: jose.id, coachUserId: coachUser.id, summary: "Reliable, coachable, and consistent on the phones. Handles rejection well and keeps clean notes.", communication: 5, reliability: 5, coachability: 4, overallLabelId: labelIds.get("EXCELLENT"), visibleToClients: true } });
  }
  // Ana is enrolled in the paid CSR course and waiting for payment to be recorded.
  const ana = await prisma.agentProfile.findFirstOrThrow({ where: { displayName: "Ana L." } });
  const csrCourse = await prisma.academyCourse.findUniqueOrThrow({ where: { code: "customer-service-excellence" } });
  if (!(await prisma.courseEnrollment.findUnique({ where: { courseId_agentProfileId: { courseId: csrCourse.id, agentProfileId: ana.id } } }))) {
    await prisma.courseEnrollment.create({ data: { courseId: csrCourse.id, agentProfileId: ana.id, status: "ENROLLED", paymentStatus: "PENDING", priceCents: csrCourse.priceCents } });
  }

  console.log("Seed complete.");
  console.log("Roles:", roleIds.size, "| Permissions:", permIds.size, "| Agreements:", AGREEMENTS.length, "| Skills:", SKILLS.length, "| Software:", SOFTWARE.length);
  console.log(`\nDemo accounts (password: ${DEMO_PASSWORD}):`);
  for (const u of STAFF_USERS) console.log(`  ${u.role.padEnd(12)} ${u.email}${u.role === "SUPER_ADMIN" || u.role === "ADMIN" ? "  (MFA setup on first login)" : ""}`);
  console.log(`  ${"CLIENT".padEnd(12)} hiring@acme-solar.example  (active, managed by sales@)`);
  console.log(`  ${"CLIENT".padEnd(12)} ops@beta-corp.example  (active, has a shortlist)`);
  console.log(`  ${"AGENT".padEnd(12)} maria@talent.example  (draft profile: add résumé + video, then submit)`);
  console.log(`  ${"AGENT".padEnd(12)} jose@ / ana@ / carlo@talent.example  (approved, searchable; jose@ certified, ana@ has a pending course payment)`);
  console.log(`  ${"COACH".padEnd(12)} coach@hirewise.example  (owns 3 courses: 2 published, 1 draft)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
