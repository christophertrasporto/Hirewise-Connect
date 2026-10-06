"use client";

import { useActionState, useState } from "react";
import { Send, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { changeRoleAction, grantOverrideAction, inviteStaffAction, resendInviteAction, revokeOverrideAction, userStatusAction } from "@/app/(app)/user-admin-actions";
import { idle } from "@/server/http/action-result";
import { Field, FormAlert, Input, Select, SubmitButton, DevLink } from "@/components/ui/Form";

export type RoleOption = { key: string; name: string };
export type PermissionOption = { key: string; group: string; description: string };
export type OverrideRow = { id: string; permission: string; reason: string; grantedBy: string; grantedAt: Date | string; expiresAt: Date | string | null; expired: boolean };

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

export function InviteStaffForm({ roles }: { roles: RoleOption[] }) {
  const [state, action] = useActionState(inviteStaffAction, idle);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="Work email" htmlFor="invite-email" error={fe.email}>
        <Input id="invite-email" name="email" type="email" placeholder="name@yourcompany.com" invalid={!!fe.email} />
      </Field>
      <Field label="Role" htmlFor="invite-role" error={fe.role} hint="The role decides what they can see and do. Super Admin and Admin must enrol an authenticator app at first sign-in.">
        <Select id="invite-role" name="role" defaultValue="SALES">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </Select>
      </Field>
      <Field label="Note for the audit log (optional)" htmlFor="invite-reason" error={fe.reason}>
        <Input id="invite-reason" name="reason" placeholder="e.g. New recruiter starting Monday" />
      </Field>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Account created. A set-password link was emailed; it is valid for 7 days.</FormAlert>}
      {state.ok && state.data?.devUrl && <DevLink url={state.data.devUrl} label="Set-password link (development only)" />}
      <SubmitButton pendingText="Creating…"><Send className="mr-1.5 h-4 w-4" /> Send invitation</SubmitButton>
    </form>
  );
}

export function ResendInviteButton({ userId }: { userId: string }) {
  const [state, action] = useActionState(resendInviteAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="userId" value={userId} />
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">A new set-password link was emailed (valid 7 days).</FormAlert>}
      {state.ok && state.data?.devUrl && <DevLink url={state.data.devUrl} label="Set-password link (development only)" />}
      <SubmitButton variant="outline" pendingText="Sending…" className="h-9 text-[13px]">Resend set-password link</SubmitButton>
    </form>
  );
}

export function ChangeRoleForm({ userId, currentRole, roles }: { userId: string; currentRole: string; roles: RoleOption[] }) {
  const [state, action] = useActionState(changeRoleAction, idle);
  const [role, setRole] = useState(currentRole);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="userId" value={userId} />
      <Field label="Role" htmlFor={`role-${userId}`} error={fe.role}>
        <Select id={`role-${userId}`} name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </Select>
      </Field>
      {role !== currentRole && (
        <>
          <Field label="Reason (audit log)" htmlFor={`role-reason-${userId}`} error={fe.reason}>
            <Input id={`role-reason-${userId}`} name="reason" placeholder="e.g. Moved from Sales to Operations" invalid={!!fe.reason} />
          </Field>
          <p className="text-[12.5px] text-ink-500">They are signed out everywhere and get the new access at their next sign-in.</p>
        </>
      )}
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Role updated.</FormAlert>}
      <SubmitButton pendingText="Saving…" disabled={role === currentRole} className="h-9 text-[13px]">Change role</SubmitButton>
    </form>
  );
}

export function UserStatusForm({ userId, status, email }: { userId: string; status: string; email: string }) {
  const [state, action] = useActionState(userStatusAction, idle);
  const suspend = status === "ACTIVE";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" noValidate onSubmit={(e) => { if (suspend && !window.confirm(`Suspend ${email}? They are signed out immediately and cannot sign in until reinstated.`)) e.preventDefault(); }}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="op" value={suspend ? "SUSPEND" : "REINSTATE"} />
      <Input name="reason" placeholder="Reason (audit log)" className="h-9 w-[220px] text-[13px]" required />
      <SubmitButton variant={suspend ? "danger" : "primary"} pendingText="…" className="h-9 px-3 text-[12.5px]">{suspend ? <><ShieldOff className="mr-1 h-3.5 w-3.5" /> Suspend</> : <><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Reinstate</>}</SubmitButton>
      {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
      {state.ok && <span className="w-full text-[12px] font-medium text-brand-700">{suspend ? "Suspended." : "Reinstated."}</span>}
    </form>
  );
}

export function GrantOverrideForm({ userId, permissions }: { userId: string; permissions: PermissionOption[] }) {
  const [state, action] = useActionState(grantOverrideAction, idle);
  const fe = state.fieldErrors ?? {};
  const groups = [...new Set(permissions.map((p) => p.group))];
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="userId" value={userId} />
      <Field label="Extra permission" htmlFor={`ov-perm-${userId}`} error={fe.permission} hint="Only permissions the role does not already include are listed.">
        <Select id={`ov-perm-${userId}`} name="permission" defaultValue={permissions[0]?.key ?? ""}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {permissions.filter((p) => p.group === g).map((p) => <option key={p.key} value={p.key}>{p.key} — {p.description}</option>)}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <Field label="Reason (audit log)" htmlFor={`ov-reason-${userId}`} error={fe.reason}>
          <Input id={`ov-reason-${userId}`} name="reason" placeholder="e.g. Covering margin reports while the owner travels" invalid={!!fe.reason} />
        </Field>
        <Field label="Expires (optional)" htmlFor={`ov-exp-${userId}`} error={fe.expiresAt}>
          <Input id={`ov-exp-${userId}`} name="expiresAt" type="date" />
        </Field>
      </div>
      {state.error && <FormAlert>{state.error}</FormAlert>}
      {state.ok && <FormAlert tone="success">Permission granted. It applies on their next request.</FormAlert>}
      <SubmitButton pendingText="Granting…" className="h-9 text-[13px]" disabled={permissions.length === 0}>Grant permission</SubmitButton>
    </form>
  );
}

export function OverrideList({ overrides, canRevoke }: { overrides: OverrideRow[]; canRevoke: boolean }) {
  if (overrides.length === 0) return <p className="text-[13px] text-ink-400">No extra permissions beyond the role.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {overrides.map((o) => <OverrideItem key={o.id} o={o} canRevoke={canRevoke} />)}
    </ul>
  );
}

function OverrideItem({ o, canRevoke }: { o: OverrideRow; canRevoke: boolean }) {
  const [state, action] = useActionState(revokeOverrideAction, idle);
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2.5 text-[13.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-ink-900">{o.permission}{o.expired && <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500">expired</span>}</p>
          <p className="text-[12.5px] text-ink-400">{o.reason} · granted {fmt(o.grantedAt)} by {o.grantedBy}{o.expiresAt ? ` · until ${fmt(o.expiresAt)}` : ""}</p>
        </div>
        {canRevoke && !open && <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-red-600 hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /> Revoke</button>}
      </div>
      {open && (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2" noValidate>
          <input type="hidden" name="overrideId" value={o.id} />
          <Input name="reason" placeholder="Reason (audit log)" className="h-9 w-[220px] text-[13px]" required />
          <SubmitButton variant="danger" pendingText="…" className="h-9 px-3 text-[12.5px]">Revoke</SubmitButton>
          <button type="button" onClick={() => setOpen(false)} className="text-[12.5px] font-semibold text-ink-500">Cancel</button>
          {state.error && <span className="w-full text-[12px] text-red-600">{state.error}</span>}
        </form>
      )}
    </li>
  );
}
