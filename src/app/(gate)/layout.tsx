import { Logo } from "@/components/ui/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { requireAuth } from "@/server/auth/require-actor";
import { logoutAction } from "@/app/(auth)/actions";

/** Gate pages: session required, but the later gates (MFA, email, agreements) are what these pages satisfy. */
export default async function GateLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth("session");
  return (
    <div className="flex min-h-dvh flex-col bg-app">
      <header className="border-b border-ink-100 bg-white/80 backdrop-blur">
        <div className="container-x flex h-[68px] items-center justify-between">
          <Logo />
          <form action={logoutAction} className="flex items-center gap-2 text-[13px] text-ink-500">
            <ThemeToggle />
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
