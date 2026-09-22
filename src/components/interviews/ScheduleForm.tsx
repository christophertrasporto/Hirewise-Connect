"use client";

import { useActionState } from "react";
import { CalendarPlus } from "lucide-react";
import { scheduleInterviewsAction } from "@/app/(app)/actions";
import { idle } from "@/server/http/action-result";
import { Input, Select, Checkbox, SubmitButton, FormAlert } from "@/components/ui/Form";
import { TIMEZONES } from "@/lib/options";

type Candidate = { agentProfileId: string; displayName: string; status: string };

export function ScheduleForm({ requestId, candidates, defaultTimezone }: { requestId: string; candidates: Candidate[]; defaultTimezone: string }) {
  const [state, action] = useActionState(scheduleInterviewsAction, idle);
  const eligible = candidates.filter((c) => c.status !== "DECLINED" && c.status !== "WITHDRAWN");
  if (state.ok) return <FormAlert tone="success">Interviews scheduled. Client and candidates have been notified, reminders are queued.</FormAlert>;
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <div>
        <label className="mb-1.5 block text-[13.5px] font-semibold text-ink-800" htmlFor="timezone">Timezone for these times</label>
        <Select id="timezone" name="timezone" defaultValue={defaultTimezone}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>
      </div>
      <div className="space-y-3">
        {eligible.map((c) => (
          <div key={c.agentProfileId} className="rounded-2xl border border-ink-100 p-4">
            <Checkbox name="agentProfileId" value={c.agentProfileId} defaultChecked={c.status === "CONFIRMED"} label={<span className="font-semibold">{c.displayName} <span className="font-normal text-ink-400">· {c.status.toLowerCase()}</span></span>} />
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px_1fr]">
              <Input type="datetime-local" name={`scheduledAt:${c.agentProfileId}`} aria-label="Date and time" />
              <Input type="number" name={`durationMin:${c.agentProfileId}`} defaultValue={30} min={15} max={180} aria-label="Duration (minutes)" />
              <Input type="url" name={`meetingLink:${c.agentProfileId}`} placeholder="Meeting link (Zoom, Meet)" />
            </div>
          </div>
        ))}
        {eligible.length === 0 && <p className="text-[13.5px] text-ink-400">No eligible candidates.</p>}
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      <SubmitButton variant="primary" pendingText="Scheduling…"><CalendarPlus className="h-4 w-4" /> Schedule and notify</SubmitButton>
    </form>
  );
}
