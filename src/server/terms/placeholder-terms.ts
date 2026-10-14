/**
 * The unified "Hirewise Connect Terms & Platform Agreement" and the Privacy Policy, version 1, as PLACEHOLDER text.
 * Counsel supplies the real wording before production (MASTER_PROMPT Section 14 Q11); nothing here is legal language.
 *
 * This module is the single source for the seed, the data migration (which embeds the same bodies and checksums), and
 * the tests that assert the two stay identical. Change a section here and regenerate the migration body.
 */

export type TermsAudience = "ALL" | "AGENT" | "AGENCY_OWNER" | "CLIENT" | "TRAINING";

export type TermsSection = {
  key: string;
  title: string;
  audiences: TermsAudience[];
  bodyMarkdown: string;
};

export const PLACEHOLDER_MARK = "LEGAL_PLACEHOLDER";

export const PLATFORM_TERMS_TITLE = "Hirewise Connect Terms & Platform Agreement";
export const PRIVACY_POLICY_TITLE = "Hirewise Connect Privacy Policy";

const ph = (topic: string) => `${PLACEHOLDER_MARK} - counsel-approved text for "${topic}" goes here. This section is a placeholder and carries no legal effect.`;

/** The spec's topic list, grouped into the five audiences the signup page highlights per role. */
export const PLATFORM_TERMS_SECTIONS: TermsSection[] = [
  { key: "general.definitions", title: "Definitions and parties", audiences: ["ALL"], bodyMarkdown: ph("definitions, Hirewise Connect as the platform, who the parties are") },
  { key: "general.account", title: "Account rules and acceptable use", audiences: ["ALL"], bodyMarkdown: ph("account rules, one person one identity, accurate information, acceptable use") },
  { key: "general.role", title: "Hirewise Connect's role", audiences: ["ALL"], bodyMarkdown: ph("Hirewise controls client acquisition, pricing, proposals, placement, communication, billing, and platform rules") },
  { key: "agent.membership", title: "Agency membership", audiences: ["AGENT", "AGENCY_OWNER"], bodyMarkdown: ph("what joining an agency on the platform means, invitation links, seats, membership records") },
  { key: "agent.exclusivity", title: "Agent exclusivity", audiences: ["AGENT", "AGENCY_OWNER"], bodyMarkdown: ph("one active agency at a time, no second profile, no direct submissions or client contact while a membership is active") },
  { key: "agency.seats", title: "Agent Seats and seat usage", audiences: ["AGENCY_OWNER"], bodyMarkdown: ph("agent seat capacity, seat packages, seat release rules, no seat removal below usage without Hirewise") },
  { key: "training.access", title: "Course access", audiences: ["TRAINING"], bodyMarkdown: ph("course access, enrolment sources, what happens to access when a sponsorship ends") },
  { key: "training.sponsorship", title: "Training sponsorship", audiences: ["TRAINING", "AGENCY_OWNER"], bodyMarkdown: ph("agency-sponsored training, who pays, who owns the outcome") },
  { key: "training.certifications", title: "Certification ownership and revocation", audiences: ["TRAINING"], bodyMarkdown: ph("certifications issued by Hirewise, agency-funded certifications becoming inactive for platform use on exit, re-earning as independent") },
  { key: "training.assessments", title: "Assessments", audiences: ["TRAINING"], bodyMarkdown: ph("assessments, historical status after exit, use in eligibility") },
  { key: "agent.leaving", title: "Leaving an agency", audiences: ["AGENT", "AGENCY_OWNER"], bodyMarkdown: ph("request to leave, agency removal, Hirewise review, effective dates, exit actions") },
  { key: "agent.independent", title: "Independent reapplication", audiences: ["AGENT"], bodyMarkdown: ph("applying as an independent freelancer after an agency membership ends, fresh profile, no inherited credentials") },
  { key: "client.opportunities", title: "Client opportunities", audiences: ["CLIENT", "AGENCY_OWNER", "AGENT"], bodyMarkdown: ph("opportunities shared by Hirewise, submissions, eligibility, masked client details until disclosure") },
  { key: "client.communications", title: "Client communications and platform messaging", audiences: ["ALL"], bodyMarkdown: ph("all pre-placement communication on the platform, contact details, interviews scheduled by Hirewise") },
  { key: "general.circumvention", title: "Direct hiring and non-circumvention", audiences: ["ALL"], bodyMarkdown: ph("no direct hiring or engagement outside Hirewise, duration, reporting, consequences") },
  { key: "general.payments", title: "Payments and refunds", audiences: ["CLIENT", "AGENCY_OWNER", "AGENT"], bodyMarkdown: ph("payments, invoices, deposits, seat packages, course purchases, refunds") },
  { key: "general.suspension", title: "Suspension and termination", audiences: ["ALL"], bodyMarkdown: ph("warnings, restrictions, suspension, termination, effect on memberships and data") },
  { key: "general.privacy", title: "Data and privacy", audiences: ["ALL"], bodyMarkdown: ph("reference to the Privacy Policy, identity records, what clients and agencies can see") },
  { key: "general.ip", title: "Intellectual property", audiences: ["ALL"], bodyMarkdown: ph("platform content, course materials, recordings licence, trademarks") },
  { key: "general.disputes", title: "Dispute process", audiences: ["ALL"], bodyMarkdown: ph("how disputes are raised and resolved, escalation") },
  { key: "general.law", title: "Governing law", audiences: ["ALL"], bodyMarkdown: ph("governing law and venue") },
];

export const PRIVACY_POLICY_SECTIONS: TermsSection[] = [
  { key: "privacy.collected", title: "Data we collect", audiences: ["ALL"], bodyMarkdown: ph("account, identity, profile, training, placement, and usage data") },
  { key: "privacy.use", title: "How we use data", audiences: ["ALL"], bodyMarkdown: ph("purposes: matching, training, placement, billing, platform safety, duplicate detection") },
  { key: "privacy.sharing", title: "What clients and agencies can see", audiences: ["ALL"], bodyMarkdown: ph("client-safe profiles, partner team identities, disclosure grants, what is never shared") },
  { key: "privacy.retention", title: "Retention", audiences: ["ALL"], bodyMarkdown: ph("retention periods, archived profiles, identity history") },
  { key: "privacy.rights", title: "Your rights", audiences: ["ALL"], bodyMarkdown: ph("access, correction, deletion requests, contact") },
];

/** Which audiences a role reads first. Staff see everything. */
export function audiencesForRole(role: string): TermsAudience[] {
  switch (role) {
    case "AGENT":
      return ["ALL", "AGENT", "TRAINING"];
    case "CLIENT":
      return ["ALL", "CLIENT"];
    case "APPLICANT":
    case "AGENCY_OWNER":
    case "AGENCY_MANAGER":
      return ["ALL", "AGENCY_OWNER", "TRAINING"];
    default:
      return ["ALL", "AGENT", "AGENCY_OWNER", "CLIENT", "TRAINING"];
  }
}

/** The stored bodyMarkdown of a versioned document: title, placeholder notice, numbered sections. */
export function renderTermsBody(title: string, sections: TermsSection[]): string {
  const hasPlaceholder = sections.some((s) => s.bodyMarkdown.includes(PLACEHOLDER_MARK));
  const lines = [`# ${title}`, ""];
  if (hasPlaceholder) lines.push(`> ${PLACEHOLDER_MARK} - replace with counsel-approved text before launch.`, "");
  sections.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.title}`, "", s.bodyMarkdown.trim(), "");
  });
  return lines.join("\n").trimEnd() + "\n";
}

export function checkboxLabel(mode: "COMBINED" | "SEPARATE"): string {
  return mode === "SEPARATE"
    ? "I agree to the Hirewise Connect Terms & Platform Agreement and acknowledge the Privacy Policy."
    : "I have read and agree to the Hirewise Connect Terms & Platform Agreement and Privacy Policy.";
}
