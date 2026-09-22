import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getAgentForStaff } from "@/server/services/agent.service";
import { NotFoundError } from "@/server/policies/authorize";
import { AGENT_PROFILE_TRANSITIONS } from "@/server/state/agent-profile";
import { PageHeader, Card, StatusBadge, EmptyState, fmtDate } from "@/components/app/ui";
import { ReviewActions } from "@/components/staff/ReviewActions";
import { MediaPlayer } from "@/components/profile/MediaPlayer";
import { ResumeLink } from "@/components/staff/ResumeLink";
import { NotesPanel } from "@/components/staff/NotesPanel";
import { listNotesForStaff } from "@/server/services/note.service";
import { ReserveForm } from "@/components/staff/ReservationForm";
import { clientRepository } from "@/server/repositories/client.repository";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Agent profile" };

export default async function StaffAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let a: Awaited<ReturnType<typeof getAgentForStaff>>;
  try {
    a = await getAgentForStaff(prisma, actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const notes = actor.permissions.has("note.internal.read") ? await listNotesForStaff(prisma, actor, "AGENT", a.id) : [];
  const reservableClients = actor.permissions.has("reservation.manage") && a.status === "APPROVED" ? (await clientRepository.listByStatus(prisma, "ACTIVE")).map((c) => ({ id: c.id, companyName: c.companyName })) : [];
  const allowed = AGENT_PROFILE_TRANSITIONS.filter((t) => t.from === a.status && t.permission !== "OWNER" && actor.permissions.has(t.permission)).map((t) => ({ to: t.to, requiresReason: !!t.requiresReason }));

  return (
    <>
      <Link href="/staff/talent" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Back to pipeline</Link>
      <PageHeader eyebrow={a.primaryRole ?? "Talent"} title={a.displayName} description={a.headline ?? "No headline yet."} actions={<><StatusBadge status={a.status} /><StatusBadge status={a.verificationLevel} /><StatusBadge status={a.availabilityStatus} /></>} />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-5">
          <Card title="Summary">
            <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink-700">{a.summary ?? "—"}</p>
            <dl className="mt-5 grid gap-3 text-[14px] sm:grid-cols-3">
              <Item k="Experience" v={`${a.yearsExperience ?? 0} yrs · ${a.experienceLevel ? labelFor(a.experienceLevel) : "—"}`} />
              <Item k="Location" v={[a.locationCity, a.locationCountry].filter(Boolean).join(", ") || "—"} />
              <Item k="Timezone" v={a.timezone ?? "—"} />
              <Item k="Languages" v={a.languages.join(", ") || "—"} />
              <Item k="Setup" v={a.workSetup ?? "—"} />
              <Item k="Shift" v={a.preferredShift ?? "—"} />
              <Item k="Equipment" v={a.equipmentSummary ?? "—"} />
              <Item k="Internet" v={a.internetSummary ?? "—"} />
              <Item k="Completion" v={`${a.profileCompletion}%`} />
            </dl>
          </Card>

          <Card title="Skills and software">
            <div className="flex flex-wrap gap-1.5">
              {a.skills.map((s) => <span key={s.skillId} className="rounded-full bg-ink-100 px-2.5 py-1 text-[12.5px] font-medium text-ink-700">{s.name} · {labelFor(s.level)}{s.yearsUsed ? ` · ${s.yearsUsed}y` : ""}</span>)}
              {a.skills.length === 0 && <span className="text-[13.5px] text-ink-400">None</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.software.map((s) => <span key={s.softwareId} className="rounded-full bg-brand-50 px-2.5 py-1 text-[12.5px] font-medium text-brand-700">{s.name} · {labelFor(s.level)}</span>)}
            </div>
            {a.industries.length > 0 && <p className="mt-3 text-[13.5px] text-ink-500">Industries: {a.industries.map((i) => `${i.industry} (${i.years}y)`).join(", ")}</p>}
          </Card>

          <Card title="Experience">
            {a.experiences.length === 0 ? <EmptyState title="No experience listed" /> : (
              <ul className="divide-y divide-ink-100">
                {a.experiences.map((e) => (
                  <li key={e.id} className="py-3">
                    <p className="text-[15px] font-semibold text-ink-900">{e.title}{e.company ? ` · ${e.company}` : ""}</p>
                    <p className="text-[12.5px] text-ink-400">{fmtDate(e.startDate)} – {e.endDate ? fmtDate(e.endDate) : "Present"}{e.industry ? ` · ${e.industry}` : ""}{e.isCampaign ? ` · Campaign${e.campaignType ? `: ${e.campaignType}` : ""}` : ""}</p>
                    {e.description && <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">{e.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Video">
              {a.videos.filter((v) => v.status !== "RETIRED").length === 0 ? <EmptyState title="No video" /> : a.videos.filter((v) => v.status !== "RETIRED").map((v) => (
                <div key={v.id} className="mb-3">
                  <div className="flex items-center justify-between"><span className="text-[13px] text-ink-500">{fmtDate(v.createdAt)}</span><StatusBadge status={v.status} /></div>
                  <MediaPlayer type="VIDEO" id={v.id} />
                </div>
              ))}
            </Card>
            <Card title="Voice samples">
              {a.recordings.length === 0 ? <EmptyState title="No recordings" /> : a.recordings.map((r) => (
                <div key={r.id} className="mb-3">
                  <div className="flex items-center justify-between"><span className="text-[13.5px] font-medium text-ink-800">{r.title} <span className="font-normal text-ink-400">· {labelFor(r.kind).toLowerCase()}</span></span><StatusBadge status={r.status} /></div>
                  <MediaPlayer type="RECORDING" id={r.id} />
                </div>
              ))}
            </Card>
          </div>
        </div>

        <div className="space-y-5">
          <Card title="Review">
            {allowed.length === 0 ? <p className="text-[14px] text-ink-500">No actions available for you at status {labelFor(a.status).toLowerCase()}.</p> : <ReviewActions agentProfileId={a.id} allowed={allowed} />}
          </Card>
          <Card title="Private contact" description={a.privateContact ? "Visible to you because you hold agent.read_private_contact." : "Requires agent.read_private_contact."}>
            {a.privateContact ? (
              <dl className="space-y-2 text-[14px]">
                <Item k="Legal name" v={a.privateContact.fullLegalName} />
                <Item k="Login email" v={a.email ?? "—"} />
                <Item k="Phone" v={a.privateContact.phone ?? "—"} />
                <Item k="Address" v={a.privateContact.addressLine ?? "—"} />
                <div><dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Résumé</dt><dd className="mt-0.5">{a.privateContact.hasResume ? <ResumeLink agentProfileId={a.id} /> : <span className="text-ink-500">Not uploaded</span>}</dd></div>
              </dl>
            ) : (
              <p className="text-[13.5px] text-ink-400">Hidden.</p>
            )}
          </Card>
          {reservableClients.length > 0 && a.availabilityStatus !== "RESERVED" && a.availabilityStatus !== "PLACED" && (
            <Card title="Reserve for a client" description="Holds the candidate for one client for the configured period.">
              <ReserveForm agentProfileId={a.id} clients={reservableClients} />
            </Card>
          )}
          {actor.permissions.has("note.internal.read") && (
            <Card title="Internal notes" description="Never shown to the agent or clients unless you mark a note visible.">
              <NotesPanel subjectType="AGENT" subjectId={a.id} notes={notes} canWrite={actor.permissions.has("note.internal.write")} />
            </Card>
          )}
          <Card title="Timeline">
            <dl className="space-y-2 text-[14px]">
              <Item k="Submitted" v={fmtDate(a.submittedAt)} />
              <Item k="Approved" v={fmtDate(a.approvedAt)} />
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{k}</dt>
      <dd className="mt-0.5 font-medium break-words text-ink-800">{v}</dd>
    </div>
  );
}
