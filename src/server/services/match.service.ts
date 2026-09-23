import type { PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { NotFoundError } from "@/server/policies/authorize";
import { assertClientOwns } from "@/server/policies/ownership";
import { requirementRepository } from "@/server/repositories/requirement.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { shortlistRepository } from "@/server/repositories/shortlist.repository";
import { taxonomyRepository } from "@/server/repositories/taxonomy.repository";
import { toCandidateCardView, type CandidateCardView } from "@/server/views/agent.views";
import { timezoneOffsetHours } from "@/lib/timezones";
import { getSetting, type SettingValue } from "./setting.service";
import { monthlyEquivalent } from "@/server/state/placement";

/**
 * Section 10, Phase 5: rule-based matching with explanations. No ML (INV-C6).
 * Hard rules: required skills, role, availability (unless includeSoon widens it).
 * Soft rules are weighted by Setting.matchWeights and every result explains itself.
 * Results are deterministic for a fixed dataset: score desc, then approval date, then id.
 */

export type MatchReason = { rule: string; matched: boolean; text: string; points: number; max: number };
export type MatchResult = { candidate: CandidateCardView & { shortlisted: boolean }; score: number; maxScore: number; percent: number; reasons: MatchReason[]; hardFails: string[] };

type Weights = SettingValue<"matchWeights">;
const LEVELS = ["ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD"] as const;

function norm(s: string) {
  return s.trim().toLowerCase();
}

/** Score one candidate against a requirement. Pure so unit tests can pin the numbers. */
export function scoreCandidate(req: { role: string; skills: string[]; industry: string | null; experienceLevel: string | null; timezone: string | null; budgetMax: number | null; budgetMin: number | null; software: string[] }, cand: { primaryRole: string | null; skills: string[]; industries: string[]; experienceLevel: string | null; timezone: string | null; certifications: Array<{ name: string }>; assessmentRank: number | null; clientRate: { amount: number; unit: "HOURLY" | "MONTHLY" } | null; availabilityStatus: string; software: string[] }, weights: Weights, opts: { includeSoon: boolean; hoursPerMonth: number }): { score: number; maxScore: number; reasons: MatchReason[]; hardFails: string[] } {
  const reasons: MatchReason[] = [];
  const hardFails: string[] = [];

  // Hard: role
  const roleOk = !!cand.primaryRole && norm(cand.primaryRole) === norm(req.role);
  if (!roleOk) hardFails.push(`Role is ${cand.primaryRole ?? "unset"}, requirement asks for ${req.role}`);

  // Hard: availability
  const availOk = cand.availabilityStatus === "AVAILABLE" || (opts.includeSoon && cand.availabilityStatus === "AVAILABLE_SOON");
  if (!availOk) hardFails.push(`Availability is ${cand.availabilityStatus.toLowerCase().replace(/_/g, " ")}`);

  // Hard-ish: required skills. All required skills must be present; partial coverage still scores when at least one matches.
  const reqSkills = req.skills.map(norm);
  const candSkills = new Set(cand.skills.map(norm));
  const matchedSkills = reqSkills.filter((s) => candSkills.has(s));
  if (reqSkills.length > 0) {
    const ratio = matchedSkills.length / reqSkills.length;
    const pts = Math.round(weights.skills * ratio);
    reasons.push({ rule: "skills", matched: ratio === 1, text: `Matched ${matchedSkills.length}/${reqSkills.length} required skills${matchedSkills.length < reqSkills.length ? ` (missing ${reqSkills.filter((s) => !candSkills.has(s)).join(", ")})` : ""}`, points: pts, max: weights.skills });
    if (matchedSkills.length === 0) hardFails.push("None of the required skills");
  } else {
    reasons.push({ rule: "skills", matched: true, text: "No required skills specified", points: weights.skills, max: weights.skills });
  }

  // Soft: industry
  if (req.industry) {
    const ok = cand.industries.map(norm).includes(norm(req.industry));
    reasons.push({ rule: "industry", matched: ok, text: ok ? `Industry experience in ${req.industry}` : `No ${req.industry} experience listed`, points: ok ? weights.industry : 0, max: weights.industry });
  }

  // Soft: experience level (at or above)
  if (req.experienceLevel) {
    const want = LEVELS.indexOf(req.experienceLevel as (typeof LEVELS)[number]);
    const have = cand.experienceLevel ? LEVELS.indexOf(cand.experienceLevel as (typeof LEVELS)[number]) : -1;
    const ok = have >= want && want >= 0;
    const near = have === want - 1;
    reasons.push({ rule: "experienceLevel", matched: ok, text: ok ? `Experience level ${cand.experienceLevel} meets ${req.experienceLevel}` : `Experience level ${cand.experienceLevel ?? "unset"} is below ${req.experienceLevel}`, points: ok ? weights.experienceLevel : near ? Math.round(weights.experienceLevel / 2) : 0, max: weights.experienceLevel });
  }

  // Soft: certifications (any approved certification counts; role-related certification names score fully)
  const certNames = cand.certifications.map((c) => c.name);
  if (certNames.length > 0) {
    const roleWords = norm(req.role).split(/\s+/).filter((w) => w.length > 3);
    const related = certNames.filter((n) => roleWords.some((w) => norm(n).includes(w)));
    const pts = related.length > 0 ? weights.certifications : Math.round(weights.certifications / 2);
    reasons.push({ rule: "certifications", matched: true, text: related.length > 0 ? `Certified: ${related.join(", ")}` : `Holds ${certNames.length} Hirewise certification(s)`, points: pts, max: weights.certifications });
  } else {
    reasons.push({ rule: "certifications", matched: false, text: "No Hirewise certification yet", points: 0, max: weights.certifications });
  }

  // Soft: timezone overlap (difference in hours, wrapped)
  if (req.timezone && cand.timezone) {
    const a = timezoneOffsetHours(req.timezone);
    const b = timezoneOffsetHours(cand.timezone);
    if (a !== null && b !== null) {
      const raw = Math.abs(a - b);
      const diff = Math.min(raw, 24 - raw);
      const pts = diff <= 3 ? weights.timezone : diff <= 6 ? Math.round(weights.timezone * 0.7) : diff <= 9 ? Math.round(weights.timezone * 0.4) : 0;
      reasons.push({ rule: "timezone", matched: diff <= 6, text: `Timezone difference ${diff}h from ${req.timezone}`, points: pts, max: weights.timezone });
    }
  }

  // Soft: published rate within budget (monthly equivalent)
  if (req.budgetMax !== null) {
    if (cand.clientRate) {
      const monthly = monthlyEquivalent(cand.clientRate, opts.hoursPerMonth);
      const ok = monthly <= req.budgetMax && (req.budgetMin === null || monthly >= req.budgetMin);
      reasons.push({ rule: "budget", matched: ok, text: ok ? `Published rate (${(monthly / 100).toFixed(0)}/month) within budget` : `Published rate (${(monthly / 100).toFixed(0)}/month) outside budget ${req.budgetMin !== null ? `${(req.budgetMin / 100).toFixed(0)}–` : "up to "}${(req.budgetMax / 100).toFixed(0)}`, points: ok ? weights.budget : 0, max: weights.budget });
    } else {
      reasons.push({ rule: "budget", matched: false, text: "No published client rate yet", points: 0, max: weights.budget });
    }
  }

  // Soft: assessment label rank
  if (cand.assessmentRank !== null && cand.assessmentRank > 0) {
    const pts = Math.min(weights.assessment, Math.round((weights.assessment * cand.assessmentRank) / 3));
    reasons.push({ rule: "assessment", matched: cand.assessmentRank >= 2, text: `Coach assessment rank ${cand.assessmentRank}`, points: pts, max: weights.assessment });
  } else {
    reasons.push({ rule: "assessment", matched: false, text: "Not yet assessed by a coach", points: 0, max: weights.assessment });
  }

  // Bonus-free: software overlap is reported but unweighted (informational)
  if (req.software.length > 0) {
    const have = new Set(cand.software.map(norm));
    const hit = req.software.filter((s) => have.has(norm(s)));
    reasons.push({ rule: "software", matched: hit.length === req.software.length, text: `Knows ${hit.length}/${req.software.length} requested tools${hit.length ? ` (${hit.join(", ")})` : ""}`, points: 0, max: 0 });
  }

  const score = reasons.reduce((s, r) => s + r.points, 0);
  const maxScore = reasons.reduce((s, r) => s + r.max, 0) || 1;
  return { score, maxScore, reasons, hardFails };
}

export async function matchCandidates(db: PrismaClient, actor: Actor, requirementId: string, opts: { includeSoon?: boolean; limit?: number } = {}) {
  const req = await requirementRepository.findById(db, requirementId);
  if (!req) throw new NotFoundError();
  assertClientOwns(actor, req, "requirement.read");
  const includeSoon = opts.includeSoon ?? true;
  const [weights, hours, rows, skills, software] = await Promise.all([
    getSetting(db, "matchWeights"),
    getSetting(db, "hoursPerMonthDefault"),
    agentRepository.searchApproved(db, { availability: includeSoon ? ["AVAILABLE", "AVAILABLE_SOON"] : ["AVAILABLE"] }, 500),
    taxonomyRepository.activeSkills(db),
    taxonomyRepository.activeSoftware(db),
  ]);
  // Requirements store skill/software ids or names; resolve ids to names for comparison.
  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const softwareName = new Map(software.map((s) => [s.id, s.name]));
  const reqSkills = req.skills.map((s) => skillName.get(s) ?? s);
  const reqSoftware = req.software.map((s) => softwareName.get(s) ?? s);
  const shortlisted = actor.role === "CLIENT" && actor.clientId ? new Set((await shortlistRepository.activeAgentIds(db, actor.clientId)).map((s) => s.agentProfileId)) : new Set<string>();

  const results: MatchResult[] = rows.map((r) => {
    const bestRank = Math.max(0, ...r.assessments.map((a) => a.resultLabel?.rank ?? 0));
    const scored = scoreCandidate(
      { role: req.role, skills: reqSkills, industry: req.industry, experienceLevel: req.experienceLevel, timezone: req.timezone, budgetMax: req.budgetMax, budgetMin: req.budgetMin, software: reqSoftware },
      { primaryRole: r.primaryRole, skills: r.skills.map((s) => s.skill.name), industries: r.industryExperiences.map((i) => i.industry), experienceLevel: r.experienceLevel, timezone: r.timezone, certifications: r.certifications.filter((c) => c.status === "APPROVED").map((c) => ({ name: c.template.name })), assessmentRank: bestRank || null, clientRate: r.billingRates[0] ? { amount: r.billingRates[0].amount, unit: r.billingRates[0].unit } : null, availabilityStatus: r.availabilityStatus, software: r.softwareExperiences.map((s) => s.software.name) },
      weights,
      { includeSoon, hoursPerMonth: hours },
    );
    return { candidate: { ...toCandidateCardView(r), shortlisted: shortlisted.has(r.id) }, score: scored.score, maxScore: scored.maxScore, percent: Math.round((scored.score / scored.maxScore) * 100), reasons: scored.reasons, hardFails: scored.hardFails };
  });

  const eligible = results.filter((m) => m.hardFails.length === 0);
  const sort = (a: MatchResult, b: MatchResult) => b.score - a.score || (b.candidate.approvedAt?.getTime() ?? 0) - (a.candidate.approvedAt?.getTime() ?? 0) || a.candidate.id.localeCompare(b.candidate.id);
  eligible.sort(sort);
  const nearMisses = results.filter((m) => m.hardFails.length > 0 && m.hardFails.every((f) => f.startsWith("Availability") || f.startsWith("Role"))).sort(sort).slice(0, 5);
  return {
    requirement: { id: req.id, title: req.title, role: req.role, skills: reqSkills, software: reqSoftware, industry: req.industry, experienceLevel: req.experienceLevel, timezone: req.timezone, schedule: req.schedule, budgetMin: req.budgetMin, budgetMax: req.budgetMax, agentsRequired: req.agentsRequired, status: req.status, client: { id: req.client.id, companyName: req.client.companyName } },
    weights,
    matches: eligible.slice(0, opts.limit ?? 20),
    nearMisses,
    consideredCount: results.length,
  };
}
