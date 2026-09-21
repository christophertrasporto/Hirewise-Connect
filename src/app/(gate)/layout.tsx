import { Logo } from "@/components/ui/Logo";
import { requireAuth } from "@/server/auth/require-actor";
import { logoutAction } from "@/app/(auth)/actions";

/** Gate pages: session required, but the later gates (MFA, email, agreements) are what these pages satisfy. */
export default async function GateLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth("session");
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50/60">
      <header className="border-b border-ink-100 bg-white">
        <div className="container-x flex h-[68px] items-center justify-between">
          <Logo />
          <form action={logoutAction} className="flex items-center gap-3 text-[13px] text-ink-500">
            <span className="hidden sm:inline">{auth.email}</span>
            <button type="submit" className="rounded-full border border-ink-200 px-3.5 py-1.5 font-medium text-ink-700 hover:bg-ink-50">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="container-x flex-1 py-10 lg:py-14">{children}</main>
    </div>
  );
}
