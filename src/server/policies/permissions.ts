/**
 * Permission catalog and role matrix — MASTER_PROMPT.md Section 7.
 *
 * This file is the single source of truth. The seed writes it to the database;
 * `authorize()` checks against the Actor's resolved set. Agents and Clients hold no
 * catalog permissions: their access is ownership-based (see ownership.ts).
 */

export const PERMISSIONS = {
  // Agents
  "agent.read_public": { group: "agent", description: "Read approved, client-safe agent profile fields" },
  "agent.read_private_contact": { group: "agent", description: "Read AgentPrivateContact (legal name, phone, email, address, résumé)" },
  "agent.review": { group: "agent", description: "Move profiles through review states and request revisions" },
  "agent.approve": { group: "agent", description: "Approve or reject agent profiles" },
  "agent.suspend": { group: "agent", description: "Suspend or reinstate an agent profile" },
  "agent.hide": { group: "agent", description: "Hide or unhide an approved profile from the marketplace" },
  "agent.set_availability": { group: "agent", description: "Set an agent's availability status" },
  "agent.set_verification": { group: "agent", description: "Manually set an agent's verification level" },
  "media.review": { group: "media", description: "Review videos, recordings, and portfolio items" },
  "skills.manage": { group: "taxonomy", description: "Manage the skills and software taxonomies" },
  // Clients
  "client.read": { group: "client", description: "Read client company records" },
  "client.manage": { group: "client", description: "Edit client records and activate clients" },
  "client.assign_manager": { group: "client", description: "Assign an account manager to a client" },
  "requirement.read": { group: "client", description: "Read client hiring requirements" },
  "requirement.manage": { group: "client", description: "Edit client hiring requirements" },
  "shortlist.read_all": { group: "marketplace", description: "Read any client's shortlists" },
  // Interviews
  "interview.read_all": { group: "interview", description: "Read all interview requests and interviews" },
  "interview.coordinate": { group: "interview", description: "Work interview requests and the mediated message thread" },
  "interview.schedule": { group: "interview", description: "Schedule and reschedule interviews" },
  // Placements
  "placement.read_all": { group: "placement", description: "Read all placements" },
  "placement.manage": { group: "placement", description: "Edit placements and move them through the pipeline" },
  "placement.approve": { group: "placement", description: "Give Hirewise approval after selection" },
  "placement.activate": { group: "placement", description: "Activate a placement after deployment preparation" },
  // Commercial
  "billing_rate.read": { group: "commercial", description: "Read published client billing rates" },
  "billing_rate.propose": { group: "commercial", description: "Propose a client billing rate for approval" },
  "billing_rate.approve": { group: "commercial", description: "Approve and publish client billing rates" },
  "compensation.read": { group: "commercial", description: "Read agent compensation (confidential)" },
  "compensation.write": { group: "commercial", description: "Set agent compensation (confidential)" },
  "deposit.read": { group: "commercial", description: "Read deposits" },
  "deposit.manage": { group: "commercial", description: "Create and edit deposits" },
  "deposit.override": { group: "commercial", description: "Waive a deposit requirement with a reason" },
  "invoice.manage": { group: "commercial", description: "Issue and void invoices" },
  "payment.record": { group: "commercial", description: "Record payments against invoices" },
  // Agreements
  "agreement.manage": { group: "agreement", description: "Create and version agreements" },
  "agreement.read_acceptances": { group: "agreement", description: "Read agreement acceptance records" },
  // Academy
  "course.manage": { group: "academy", description: "Create, edit, publish, and archive any course; assign coaches; link certification templates" },
  "course.create_own": { group: "academy", description: "Create and edit courses and exams the actor coaches; set the course price; submit for publishing" },
  "course.payment.record": { group: "academy", description: "Record or waive an agent's payment for a paid course" },
  "verification.manage": { group: "academy", description: "Edit verification-level requirements and certification templates" },
  "course.read_assigned": { group: "academy", description: "Read courses and students assigned to the actor" },
  "assessment.write": { group: "academy", description: "Write assessments and coach evaluations" },
  "assessment.read_all": { group: "academy", description: "Read all assessments" },
  "certification.issue": { group: "academy", description: "Issue a certification directly (ADMIN_ISSUED)" },
  "certification.review": { group: "academy", description: "Approve pending certifications" },
  "certification.revoke": { group: "academy", description: "Revoke a certification" },
  // Notes, incidents
  "note.internal.read": { group: "notes", description: "Read internal admin notes" },
  "note.internal.write": { group: "notes", description: "Write internal admin notes" },
  "incident.read": { group: "compliance", description: "Read incidents" },
  "incident.write": { group: "compliance", description: "Create incidents" },
  "flag.review": { group: "compliance", description: "Review rule-generated activity flags" },
  "reservation.manage": { group: "marketplace", description: "Reserve, extend, and release agents" },
  "notification.broadcast": { group: "ops", description: "Send broadcast notifications" },
  // Reports
  "report.talent": { group: "report", description: "Talent reports" },
  "report.pipeline": { group: "report", description: "Pipeline and conversion reports" },
  "report.revenue": { group: "report", description: "Revenue reports (billing side)" },
  "report.academy": { group: "report", description: "Academy reports" },
  // System
  "audit.read": { group: "system", description: "Read the audit log" },
  "settings.manage": { group: "system", description: "Change platform settings" },
  "rbac.manage": { group: "system", description: "Manage roles, permissions, and overrides" },
  "user.manage": { group: "system", description: "Create, suspend, and deactivate users" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export type StaffRoleKey = "SUPER_ADMIN" | "ADMIN" | "SALES" | "RECRUITER" | "COACH" | "OPERATIONS";
export type RoleKey = StaffRoleKey | "AGENT" | "CLIENT";

const ADMIN_PERMISSIONS: PermissionKey[] = ALL_PERMISSION_KEYS.filter(
  (k) =>
    // Admin gets everything except compensation (override only) and system-level RBAC/settings.
    !["compensation.read", "compensation.write", "settings.manage", "rbac.manage"].includes(k),
);

export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  ADMIN: ADMIN_PERMISSIONS,
  SALES: [
    "agent.read_public",
    "client.read",
    "client.manage",
    "requirement.read",
    "requirement.manage",
    "shortlist.read_all",
    "interview.read_all",
    "interview.coordinate",
    "interview.schedule",
    "placement.read_all",
    "placement.manage",
    "billing_rate.read",
    "billing_rate.propose",
    "deposit.read",
    "deposit.manage",
    "invoice.manage",
    "payment.record",
    "course.payment.record",
    "agreement.read_acceptances",
    "note.internal.read",
    "note.internal.write",
    "incident.write",
    "reservation.manage",
    "report.pipeline",
    "report.revenue",
  ],
  RECRUITER: [
    "agent.read_public",
    "agent.read_private_contact",
    "agent.review",
    "agent.set_availability",
    "media.review",
    "note.internal.read",
    "note.internal.write",
    "report.talent",
  ],
  COACH: ["agent.read_public", "course.read_assigned", "course.create_own", "assessment.write", "report.academy"],
  OPERATIONS: [
    "agent.read_public",
    "agent.read_private_contact",
    "agent.set_availability",
    "agent.hide",
    "client.read",
    "requirement.read",
    "shortlist.read_all",
    "interview.read_all",
    "placement.read_all",
    "placement.manage",
    "placement.activate",
    "billing_rate.read",
    "deposit.read",
    "note.internal.read",
    "note.internal.write",
    "reservation.manage",
    "report.talent",
    "report.pipeline",
  ],
  // Ownership-based only (Section 7). Deliberately empty.
  AGENT: [],
  CLIENT: [],
};

export const ROLE_NAMES: Record<RoleKey, { name: string; description: string }> = {
  SUPER_ADMIN: { name: "Super Admin / Owner", description: "Full system access." },
  ADMIN: { name: "Admin", description: "Talent, clients, certifications, rates, placements, interviews, operational controls." },
  SALES: { name: "Hirewise Sales Team", description: "Client requirements, shortlists, interviews, rate proposals, agreements, deposits, placements." },
  RECRUITER: { name: "Recruiter", description: "Agent pipeline: registrations, profile review, screening, availability." },
  COACH: { name: "Coach / Trainer", description: "Assigned courses, enrolled students, assessments, certification recommendations." },
  OPERATIONS: { name: "Operations Manager", description: "Placements, deployment checklists, active agents, availability, reservations." },
  AGENT: { name: "Agent / Talent", description: "Own profile, media, courses, certifications, interviews, placements." },
  CLIENT: { name: "Client", description: "Own profile, marketplace, shortlists, interview requests, placements, invoices." },
};

/** Roles that require MFA (Section 3, Auth). */
export const MFA_REQUIRED_ROLES: readonly RoleKey[] = ["SUPER_ADMIN", "ADMIN"];
