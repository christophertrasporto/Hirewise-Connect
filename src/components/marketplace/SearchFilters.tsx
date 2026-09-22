import { Search, SlidersHorizontal } from "lucide-react";
import { Input, Select, Checkbox } from "@/components/ui/Form";
import { AGENT_ROLES, INDUSTRIES, LANGUAGES, EXPERIENCE_LEVELS } from "@/lib/options";
import type { SearchFilters as Filters } from "@/server/services/search.service";

type Tax = { id: string; name: string; category: string };

/** Plain GET form so searches are shareable URLs and work without JavaScript. */
export function SearchFilters({ filters, skills, software, hasClientTimezone, certifications = [], courses = [], labels = [] }: { filters: Filters; skills: Tax[]; software: Tax[]; hasClientTimezone: boolean; certifications?: Array<{ id: string; name: string }>; courses?: Array<{ id: string; title: string }>; labels?: Array<{ rank: number; label: string }> }) {
  return (
    <form method="get" action="/talent" className="rounded-3xl border border-ink-100 bg-white p-5 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input name="q" defaultValue={filters.q ?? ""} placeholder="Search headline, summary, or name" className="pl-11" />
        </div>
        <Select name="role" defaultValue={filters.role ?? ""} className="sm:w-[240px]" aria-label="Role">
          <option value="">Any role</option>
          {AGENT_ROLES.map((r) => <option key={r}>{r}</option>)}
        </Select>
        <Select name="sort" defaultValue={filters.sort ?? "recommended"} className="sm:w-[180px]" aria-label="Sort">
          <option value="recommended">Recommended</option>
          <option value="newest">Newest approved</option>
          <option value="experience">Most experience</option>
        </Select>
        <button type="submit" className="inline-flex h-11 items-center justify-center rounded-full bg-ink-900 px-6 text-[14px] font-semibold text-white hover:bg-ink-800">Search</button>
      </div>

      <details className="group mt-4" open={hasAdvanced(filters)}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-[13.5px] font-semibold text-ink-700 [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal className="h-4 w-4" /> More filters
        </summary>
        <div className="mt-4 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Group title="Skills">
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">{skills.map((s) => <Checkbox key={s.id} name="skills" value={s.id} defaultChecked={filters.skills?.includes(s.id)} label={s.name} />)}</div>
          </Group>
          <Group title="Software">
            <div className="max-h-44 space-y-1 overflow-y-auto pr-1">{software.map((s) => <Checkbox key={s.id} name="software" value={s.id} defaultChecked={filters.software?.includes(s.id)} label={s.name} />)}</div>
          </Group>
          <Group title="Experience and industry">
            <Select name="industry" defaultValue={filters.industry ?? ""} className="h-10 text-[13.5px]" aria-label="Industry">
              <option value="">Any industry</option>
              {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
            </Select>
            <div className="mt-2 space-y-1">{EXPERIENCE_LEVELS.map((l) => <Checkbox key={l.value} name="level" value={l.value} defaultChecked={filters.level?.includes(l.value)} label={l.label} />)}</div>
            <div className="mt-2"><Checkbox name="campaign" value="true" defaultChecked={!!filters.campaign} label="Campaign experience only" /></div>
          </Group>
          <Group title="Availability, setup, verification">
            <div className="space-y-1">
              {(["AVAILABLE", "AVAILABLE_SOON", "INTERVIEWING", "RESERVED", "PLACED"] as const).map((a) => <Checkbox key={a} name="availability" value={a} defaultChecked={filters.availability ? filters.availability.includes(a) : a === "AVAILABLE" || a === "AVAILABLE_SOON"} label={a.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} />)}
            </div>
            <Select name="setup" defaultValue={filters.setup ?? ""} className="mt-2 h-10 text-[13.5px]" aria-label="Work setup">
              <option value="">Any setup</option>
              <option value="REMOTE">Remote</option>
              <option value="OFFICE">Office</option>
              <option value="HYBRID">Hybrid</option>
            </Select>
            <Select name="verification" defaultValue={filters.verification ?? ""} className="mt-2 h-10 text-[13.5px]" aria-label="Minimum verification">
              <option value="">Any verification level</option>
              <option value="PROFILE_VERIFIED">Profile verified or above</option>
              <option value="SKILLS_ASSESSED">Skills assessed or above</option>
              <option value="HIREWISE_CERTIFIED">Hirewise certified or above</option>
              <option value="INTERVIEW_READY">Interview ready or above</option>
              <option value="DEPLOYMENT_READY">Deployment ready</option>
            </Select>
            <div className="mt-2 space-y-1">{LANGUAGES.slice(0, 5).map((l) => <Checkbox key={l} name="languages" value={l} defaultChecked={filters.languages?.includes(l)} label={l} />)}</div>
            {(certifications.length > 0 || labels.length > 0) && (
              <div className="mt-3 border-t border-ink-100 pt-3">
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Academy</p>
                <div className="space-y-1">{certifications.map((t) => <Checkbox key={t.id} name="certifications" value={t.id} defaultChecked={filters.certifications?.includes(t.id)} label={t.name} />)}</div>
                {courses.length > 0 && <div className="mt-1 space-y-1">{courses.slice(0, 6).map((c) => <Checkbox key={c.id} name="courses" value={c.id} defaultChecked={filters.courses?.includes(c.id)} label={`Completed: ${c.title}`} />)}</div>}
                {labels.length > 0 && (
                  <Select name="minAssessment" defaultValue={String(filters.minAssessment ?? 0)} className="mt-2 h-10 text-[13.5px]" aria-label="Minimum coach assessment">
                    <option value="0">Any coach assessment</option>
                    {labels.filter((l) => l.rank > 0).map((l) => <option key={l.rank} value={l.rank}>{l.label} or better</option>)}
                  </Select>
                )}
              </div>
            )}
            {hasClientTimezone && (
              <Select name="tzWithin" defaultValue={String(filters.tzWithin ?? 0)} className="mt-2 h-10 text-[13.5px]" aria-label="Timezone overlap">
                <option value="0">Any timezone</option>
                <option value="3">Within 3 hours of my timezone</option>
                <option value="6">Within 6 hours</option>
                <option value="9">Within 9 hours</option>
              </Select>
            )}
          </Group>
        </div>
      </details>
    </form>
  );
}

function hasAdvanced(f: Filters) {
  return !!(f.certifications?.length || f.courses?.length || f.minAssessment) || !!(f.skills?.length || f.software?.length || f.industry || f.level?.length || f.availability?.length || f.setup || f.verification || f.languages?.length || f.campaign || f.tzWithin);
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">{title}</p>
      {children}
    </div>
  );
}
