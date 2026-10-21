import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { agencyReport } from "@/server/services/agency-report.service";
import { ForbiddenError } from "@/server/policies/authorize";
import { Card, StatTile, Banner } from "@/components/app/ui";
import { labelFor } from "@/lib/options";

export const metadata: Metadata = { title: "Reports" };

/** Agency portal → Reports (v2 phase 6b): team, training, submissions, interviews, placements. Tenant-scoped. */
export default async function AgencyReportsPage() {
  const actor = await requireActor();
  let r: Awaited<ReturnType<typeof agencyReport>>;
  try {
    r = await agencyReport(prisma, actor);
  } catch (e) {
    if (e instanceof ForbiddenError) return <Banner tone="warn" title="Reports need the reports permission">{e.message}</Banner>;
    throw e;
  }
  return (
    <div className="space-y-5">
      <Card title="Team performance" description="Your agents on the marketplace. Counts only; client identities stay with Hirewise.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Approved agents" value={r.team.approved} hint={`${r.team.inReview} in review · ${r.team.draft} drafting`} />
          <StatTile label="Available now" value={r.team.available} hint={`${r.team.interviewing} interviewing or reserved · ${r.team.placed} placed`} />
          <StatTile label="Certified" value={r.team.certified} hint={`${r.team.assessed} with a final assessment`} />
          <StatTile label="Avg. experience" value={r.team.avgYearsExperience === null ? "—" : `${r.team.avgYearsExperience} yrs`} hint={r.team.byVerification.map((v) => `${v.n} ${labelFor(v.level).toLowerCase()}`).join(" · ") || "no approved agents yet"} />
        </div>
      </Card>
      <Card title="Training" description="Course Seats and progress across your members (agency-sponsored and self-funded).">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="In progress" value={r.training.enrolled} />
          <StatTile label="Completed" value={r.training.completed} hint={r.training.completionPct === null ? "no enrolments yet" : `${r.training.completionPct}% completion`} />
          <StatTile label="Dropped" value={r.training.dropped} />
          <StatTile label="Course Seats bought" value={r.training.seatsPurchased} hint="Paid or waived" />
        </div>
      </Card>
      <Card title="Opportunities and placements" description="Submissions your agency made, the interviews that followed, and placements of your agents.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Submissions" value={r.submissions.total} hint={`${r.submissions.pending} pending · ${r.submissions.approved} approved · ${r.submissions.declined} declined · ${r.submissions.withdrawn} withdrawn`} />
          <StatTile label="Interviews" value={r.interviews.scheduled} hint={`${r.interviews.requests} candidate requests`} />
          <StatTile label="Selected" value={r.submissions.selected} hint={`${r.submissions.notSelected} not selected`} />
          <StatTile label="Active placements" value={r.placements.active} hint={`${r.placements.inPipeline} in pipeline · ${r.placements.completed} completed · ${r.placements.paused} paused`} />
        </div>
      </Card>
    </div>
  );
}
