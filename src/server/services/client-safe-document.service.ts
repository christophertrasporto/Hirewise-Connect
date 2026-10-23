import { z } from "zod";
import type { Db, PrismaClient } from "@/server/db/types";
import type { Actor } from "@/server/auth/actor";
import { systemActor } from "@/server/auth/actor";
import { authorize, NotFoundError } from "@/server/policies/authorize";
import { clientSafeDocumentRepository, type ClientSafeDocumentRecord } from "@/server/repositories/client-safe-document.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { partnerRepository } from "@/server/repositories/partner.repository";
import { mediaRepository } from "@/server/repositories/media.repository";
import { audit } from "@/server/audit/audit";
import { publishEvent } from "@/server/events/outbox";
import { getSetting } from "@/server/services/setting.service";
import { getStorage } from "@/server/adapters/storage";
import { renderSimplePdf, type PdfLine } from "@/server/adapters/pdf";
import { redactForClient, clientLabelFrom } from "@/lib/client-redaction";
import { toCandidateClientView, type ClientSafeContext } from "@/server/views/agent.views";
import { toClientSafeDocumentStaffView, toClientSafeDocumentOwnerView } from "@/server/views/partner.views";

/**
 * Client-safe documents (v2 phase 5, feature 10, decisions 4 and 5). Every item a client could open has a row here.
 * Generated PDFs (profile, certificate) are built from allow-listed, redacted data; uploaded media and files wait for
 * a reviewer. Only APPROVED_FOR_CLIENT rows are ever served to clients, through `clientSafeDocumentUrl` and the
 * media gate in `media.service`. Originals are never altered.
 */

const TITLES: Record<ClientSafeDocumentRecord["type"], string> = { RESUME: "Résumé", PROFILE: "Hirewise profile (PDF)", CERTIFICATE: "Certificate", PORTFOLIO: "Portfolio item", VOICE_INTRO: "Voice sample", VIDEO_INTRO: "Video introduction" };

function isExternal(key: string) {
  return /^https?:\/\//i.test(key);
}

/** Real agency names and what clients see instead, for redaction of free text. */
export async function agencyNameReplacements(db: Db) {
  return (await partnerRepository.allNames(db)).map((a) => ({ name: a.name, replacement: a.clientFacingName ?? (a.clientFacingCode ? `Hirewise Certified Partner Team ${a.clientFacingCode}` : "a Hirewise Partner Team") }));
}

// ---------------------------------------------------------------------------
// Row creation hooks (called by outbox handlers and the maintenance pass)
// ---------------------------------------------------------------------------

async function createIfMissing(db: Db, d: Parameters<typeof clientSafeDocumentRepository.upsertSource>[1]) {
  const existing = await clientSafeDocumentRepository.findBySource(db, d.sourceType, d.sourceId);
  if (existing && existing.originalStorageKey === d.originalStorageKey) return { doc: existing, created: false };
  const doc = await clientSafeDocumentRepository.upsertSource(db, d);
  await audit(db, { actor: systemActor(), action: "CLIENT_SAFE_DOCUMENT_CREATED", entityType: "ClientSafeDocument", entityId: doc.id, newValue: { type: d.type, sourceType: d.sourceType, sourceId: d.sourceId, status: d.status } });
  if (d.status === "NEEDS_MANUAL_REVIEW") await publishEvent(db, "CLIENT_SAFE_DOCUMENT_NEEDS_REVIEW", { documentId: doc.id, agentProfileId: doc.agentProfileId, displayName: doc.agentProfile.displayName, type: d.type });
  return { doc, created: true };
}

/** Approved video or recording: always a reviewer's call (decision 4). */
export async function ensureMediaRow(db: Db, d: { agentProfileId: string; type: "VIDEO" | "RECORDING"; id: string; storageKey: string }) {
  return createIfMissing(db, { agentProfileId: d.agentProfileId, type: d.type === "VIDEO" ? "VIDEO_INTRO" : "VOICE_INTRO", sourceType: d.type, sourceId: d.id, originalStorageKey: d.storageKey, status: "NEEDS_MANUAL_REVIEW", autoNote: d.type === "VIDEO" ? "Video content cannot be scanned automatically." : "Audio content cannot be scanned automatically." });
}

export async function ensurePortfolioRow(db: Db, d: { agentProfileId: string; id: string; storageKey: string | null; url: string | null; title: string; description: string | null }) {
  const key = d.storageKey ?? d.url;
  if (!key) return null;
  const findings = redactForClient(`${d.title}\n${d.description ?? ""}`, { agencyNames: await agencyNameReplacements(db) }).findings;
  return createIfMissing(db, { agentProfileId: d.agentProfileId, type: "PORTFOLIO", sourceType: "PORTFOLIO", sourceId: d.id, originalStorageKey: key, status: "NEEDS_MANUAL_REVIEW", autoNote: d.storageKey ? "Uploaded files need a reviewer." : "External links need a reviewer.", findings: findings.length ? { text: findings } : null });
}

/** Outbox hook: looks the media item up, then ensures its row. */
export async function ensureMediaRowById(db: Db, type: "VIDEO" | "RECORDING", id: string) {
  const m = type === "VIDEO" ? await mediaRepository.findVideo(db, id) : await mediaRepository.findRecording(db, id);
  if (!m || m.status !== "APPROVED") return null;
  return ensureMediaRow(db, { agentProfileId: m.agentProfileId, type, id: m.id, storageKey: m.storageKey });
}

/** Approved certification: a client-safe PDF is generated at once. */
export async function ensureCertificateRow(db: Db, certificationId: string) {
  const c = await clientSafeDocumentRepository.certificationFor(db, certificationId);
  if (!c) return { doc: null, created: false };
  const r = await createIfMissing(db, { agentProfileId: c.agentProfileId, type: "CERTIFICATE", sourceType: "CERTIFICATION", sourceId: certificationId, originalStorageKey: `generated:certificate:${certificationId}`, status: "PENDING" });
  if (r.doc.status === "PENDING") await generateDocument(db, r.doc);
  return r;
}

/** Approved profile: the generated profile PDF stands in for the uploaded résumé (decision 4). */
export async function ensureProfileRow(db: Db, agentProfileId: string) {
  const r = await createIfMissing(db, { agentProfileId, type: "PROFILE", sourceType: "PROFILE", sourceId: agentProfileId, originalStorageKey: `generated:profile:${agentProfileId}`, status: "PENDING" });
  if (r.doc.status === "PENDING") await generateDocument(db, r.doc);
  return r;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function wrap(text: string, width = 95): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

async function profileLines(db: Db, agentProfileId: string): Promise<PdfLine[] | null> {
  const p = await agentRepository.findSelf(db, agentProfileId);
  if (!p) return null;
  const v = toCandidateClientView(p, { audience: "CLIENT", agencyNames: await agencyNameReplacements(db) });
  const lines: PdfLine[] = [
    { text: "Hirewise Connect: candidate profile", bold: true, size: 16 },
    { text: `${v.name}${v.primaryRole ? ` - ${v.primaryRole}` : ""}`, bold: true, size: 13, gap: 4 },
    { text: `${v.partnerTeam ? `Represented by ${v.partnerTeam.name}` : "Hirewise Direct talent"} - ${v.verificationLevel.replace(/_/g, " ").toLowerCase()}`, size: 10 },
    { text: `${v.yearsExperience ?? 0} years experience - ${v.locationCountry ?? "location on request"} - ${v.timezone ?? ""} - ${v.languages.join(", ")}`, size: 10 },
  ];
  if (v.headline) lines.push({ text: v.headline, size: 11, gap: 6 });
  if (v.summary) {
    lines.push({ text: "Summary", bold: true, gap: 8 });
    for (const l of wrap(v.summary)) lines.push({ text: l, size: 10 });
  }
  if (v.skills.length) lines.push({ text: "Skills", bold: true, gap: 8 }, ...wrap(v.skills.map((s) => `${s.hashtag}${s.verified ? " (verified)" : ""}`).join(", ")).map((text) => ({ text, size: 10 })));
  if (v.software.length) lines.push({ text: "Software", bold: true, gap: 6 }, ...wrap(v.software.map((s) => s.name).join(", ")).map((text) => ({ text, size: 10 })));
  if (v.experiences.length) {
    lines.push({ text: "Experience", bold: true, gap: 8 });
    for (const e of v.experiences.slice(0, 8)) {
      lines.push({ text: `${e.title}${e.industry ? ` - ${e.industry}` : ""} (${e.startDate.getFullYear()} - ${e.endDate ? e.endDate.getFullYear() : "present"})`, size: 10, bold: true });
      if (e.description) for (const l of wrap(e.description).slice(0, 3)) lines.push({ text: l, size: 9 });
    }
  }
  if (v.certifications.length) lines.push({ text: "Certifications", bold: true, gap: 8 }, ...v.certifications.map((c) => ({ text: `${c.name}${c.resultLabel ? ` - ${c.resultLabel}` : ""}`, size: 10 })));
  lines.push({ text: "Contact and commercial terms go through your Hirewise account manager. Direct contact with talent outside the platform is not permitted.", size: 8, gap: 12 });
  return lines;
}

async function certificateLines(db: Db, certificationId: string): Promise<{ lines: PdfLine[]; agentProfileId: string } | null> {
  const c = await clientSafeDocumentRepository.certificationFor(db, certificationId);
  if (!c) return null;
  const label = c.agentProfile.clientLabel ?? clientLabelFrom(null, c.agentProfile.displayName);
  const lines: PdfLine[] = [
    { text: "Hirewise VA Academy", bold: true, size: 16 },
    { text: "Certificate of achievement (client copy)", size: 12, gap: 4 },
    { text: c.template.name, bold: true, size: 14, gap: 10 },
    { text: `Awarded to ${label}`, size: 12, gap: 6 },
    { text: `Issued ${c.issuedAt.toISOString().slice(0, 10)}${c.expiresAt ? ` - valid until ${c.expiresAt.toISOString().slice(0, 10)}` : ""}`, size: 10, gap: 4 },
  ];
  if (c.certificateNumber) lines.push({ text: `Certificate ID ${c.certificateNumber}`, size: 10 });
  if (c.verificationCode) lines.push({ text: `Verify at hirewiseconnect.com/verify/${c.verificationCode}`, size: 9, gap: 4 });
  if (c.template.description) lines.push(...wrap(c.template.description).map((text) => ({ text, size: 9, gap: 0 })));
  return { lines, agentProfileId: c.agentProfileId };
}

/** Builds the PDF for a PENDING generated row and stores it under a client-safe key. */
export async function generateDocument(db: Db, doc: ClientSafeDocumentRecord) {
  if (doc.sourceType !== "CERTIFICATION" && doc.sourceType !== "PROFILE") return doc;
  const built = doc.sourceType === "PROFILE" ? await profileLines(db, doc.sourceId) : (await certificateLines(db, doc.sourceId))?.lines ?? null;
  if (!built) return clientSafeDocumentRepository.setStatus(db, doc.id, { status: "REJECTED", autoNote: "Source item no longer exists." });
  const key = `client-safe/${doc.sourceType.toLowerCase()}/${doc.id}.pdf`;
  await getStorage().put(key, renderSimplePdf(built), "application/pdf");
  const settings = await getSetting(db, "clientProtection");
  const status = settings.autoApproveGenerated ? "APPROVED_FOR_CLIENT" : "AUTO_SANITIZED";
  const updated = await clientSafeDocumentRepository.setStatus(db, doc.id, { status, sanitizedStorageKey: key, autoNote: "Generated from allow-listed profile data; contact details redacted." });
  await audit(db, { actor: systemActor(), action: "CLIENT_SAFE_DOCUMENT_REVIEWED", entityType: "ClientSafeDocument", entityId: doc.id, previousValue: { status: "PENDING" }, newValue: { status, sanitizedStorageKey: key }, reason: "auto-sanitized" });
  return updated;
}

/** Maintenance: rows for every approved source item that lacks one, then generation of pending PDFs. Idempotent. */
export async function syncClientSafeDocuments(db: Db): Promise<{ created: number; generated: number }> {
  let created = 0;
  for (const v of await db.video.findMany({ where: { status: "APPROVED" }, select: { id: true, agentProfileId: true, storageKey: true } })) if ((await ensureMediaRow(db, { agentProfileId: v.agentProfileId, type: "VIDEO", id: v.id, storageKey: v.storageKey })).created) created++;
  for (const r of await db.recording.findMany({ where: { status: "APPROVED" }, select: { id: true, agentProfileId: true, storageKey: true } })) if ((await ensureMediaRow(db, { agentProfileId: r.agentProfileId, type: "RECORDING", id: r.id, storageKey: r.storageKey })).created) created++;
  for (const i of await db.portfolio.findMany({ where: { status: "APPROVED" }, select: { id: true, agentProfileId: true, storageKey: true, url: true, title: true, description: true } })) if ((await ensurePortfolioRow(db, i))?.created) created++;
  for (const c of await db.certification.findMany({ where: { status: "APPROVED" }, select: { id: true } })) if ((await ensureCertificateRow(db, c.id)).created) created++;
  for (const p of await db.agentProfile.findMany({ where: { status: "APPROVED", deletedAt: null }, select: { id: true } })) if ((await ensureProfileRow(db, p.id)).created) created++;
  let generated = 0;
  for (const doc of await clientSafeDocumentRepository.pendingGenerated(db)) {
    await generateDocument(db, doc);
    generated++;
  }
  return { created, generated };
}

// ---------------------------------------------------------------------------
// Review queue (media.review)
// ---------------------------------------------------------------------------

export const clientSafeDecisionSchema = z.object({ id: z.string().min(1), decision: z.enum(["APPROVE", "REJECT", "REGENERATE"]), note: z.string().trim().max(1000).optional().or(z.literal("")) });

export async function listClientSafeQueue(db: PrismaClient, actor: Actor) {
  authorize(actor, "media.review");
  return (await clientSafeDocumentRepository.queue(db)).map(toClientSafeDocumentStaffView);
}

export async function reviewClientSafeDocument(db: PrismaClient, actor: Actor, raw: z.input<typeof clientSafeDecisionSchema>) {
  authorize(actor, "media.review");
  const input = clientSafeDecisionSchema.parse(raw);
  const doc = await clientSafeDocumentRepository.findById(db, input.id);
  if (!doc) throw new NotFoundError();
  const note = input.note?.trim() || null;
  if (input.decision === "REGENERATE") {
    if (doc.sourceType !== "CERTIFICATION" && doc.sourceType !== "PROFILE") throw new Error("Only generated documents can be regenerated.");
    await clientSafeDocumentRepository.setStatus(db, doc.id, { status: "PENDING" });
    return generateDocument(db, { ...doc, status: "PENDING" });
  }
  if (input.decision === "REJECT" && !note) throw new Error("A note is required when rejecting.");
  const status = input.decision === "APPROVE" ? "APPROVED_FOR_CLIENT" : "REJECTED";
  return db.$transaction(async (tx) => {
    const updated = await clientSafeDocumentRepository.setStatus(tx, doc.id, { status, reviewedById: actor.userId, reviewNote: note, sanitizedStorageKey: status === "APPROVED_FOR_CLIENT" ? doc.sanitizedStorageKey ?? doc.originalStorageKey : doc.sanitizedStorageKey });
    await audit(tx, { actor, action: "CLIENT_SAFE_DOCUMENT_REVIEWED", entityType: "ClientSafeDocument", entityId: doc.id, previousValue: { status: doc.status }, newValue: { status }, reason: note ?? undefined });
    await publishEvent(tx, "CLIENT_SAFE_DOCUMENT_REVIEWED", { documentId: doc.id, agentProfileId: doc.agentProfileId, agentUserId: doc.agentProfile.userId, agentEmail: doc.agentProfile.user.email, type: doc.type, title: TITLES[doc.type], outcome: status, note });
    return toClientSafeDocumentStaffView(updated);
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** What the client serializers need: which media and portfolio items have approved rows, and the documents to list. */
export async function clientSafeContextFor(db: Db, agentProfileIds: string[]): Promise<Map<string, ClientSafeContext>> {
  const out = new Map<string, ClientSafeContext>();
  for (const id of agentProfileIds) {
    const rows = await clientSafeDocumentRepository.approvedForAgent(db, id);
    out.set(id, {
      videoIds: new Set(rows.filter((r) => r.sourceType === "VIDEO").map((r) => r.sourceId)),
      recordingIds: new Set(rows.filter((r) => r.sourceType === "RECORDING").map((r) => r.sourceId)),
      portfolio: new Map(rows.filter((r) => r.sourceType === "PORTFOLIO").map((r) => [r.sourceId, r.id])),
      documents: rows.filter((r) => r.sourceType === "PROFILE" || r.sourceType === "CERTIFICATION").map((r) => ({ id: r.id, type: r.type, title: TITLES[r.type] })),
    });
  }
  return out;
}

/** True when a client may open this media item. */
export async function clientMayOpenMedia(db: Db, type: "VIDEO" | "RECORDING", id: string) {
  return !!(await clientSafeDocumentRepository.approvedBySource(db, type, id));
}

/** Signed URL (or external link) for one client-safe document. Clients: approved rows of approved profiles only. */
export async function clientSafeDocumentUrl(db: PrismaClient, actor: Actor, id: string): Promise<string> {
  const doc = await clientSafeDocumentRepository.findById(db, id);
  if (!doc) throw new NotFoundError();
  const own = actor.role === "AGENT" && actor.agentProfileId === doc.agentProfileId;
  const staff = actor.permissions.has("media.review") || actor.permissions.has("agent.read_public");
  if (!own && !staff) {
    if (actor.role !== "CLIENT" || doc.status !== "APPROVED_FOR_CLIENT" || doc.agentProfile.status !== "APPROVED") throw new NotFoundError();
    const { assertMarketplaceAccess } = await import("@/server/services/search.service");
    await assertMarketplaceAccess(db, actor);
  }
  const key = doc.sanitizedStorageKey ?? (own || staff ? doc.originalStorageKey : null);
  if (!key) throw new NotFoundError();
  return isExternal(key) ? key : getStorage().createDownloadUrl(key);
}

/** The agent's own rows, so they know what clients can open. */
export async function clientSafeDocumentsForSelf(db: PrismaClient, actor: Actor) {
  if (actor.role !== "AGENT" || !actor.agentProfileId) return [];
  return (await clientSafeDocumentRepository.listForAgent(db, actor.agentProfileId)).map(toClientSafeDocumentOwnerView);
}

export async function clientSafeDocumentsForStaff(db: PrismaClient, actor: Actor, agentProfileId: string) {
  authorize(actor, "agent.read_public");
  return (await clientSafeDocumentRepository.listForAgent(db, agentProfileId)).map(toClientSafeDocumentStaffView);
}
