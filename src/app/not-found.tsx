import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <Logo />
      <p className="mt-10 text-[12px] font-semibold uppercase tracking-[0.18em] text-brand-600">404</p>
      <h1 className="mt-3 text-[2.2rem] font-bold">That page is not on the platform.</h1>
      <p className="mt-3 max-w-md text-[15px] text-ink-500">The link may be outdated, or the page is part of a later phase.</p>
      <Link href="/" className="mt-8 inline-flex h-11 items-center rounded-full bg-ink-900 px-6 text-sm font-semibold text-white hover:bg-ink-800">
        Back to home
      </Link>
    </main>
  );
}
