import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getWelcomeVideoConfig, onboardingFor } from "@/server/services/onboarding.service";
import { PageHeader, Card, Banner, fmtDate } from "@/components/app/ui";
import { renderMarkdown } from "@/lib/markdown";
import { WelcomeVideoPlayer } from "@/components/onboarding/WelcomeVideoPlayer";

export const metadata: Metadata = { title: "Welcome video" };

export default async function WelcomeVideoPage() {
  const actor = await requireActor();
  if (actor.role !== "AGENT") return <Banner tone="warn" title="Talent only">The welcome video is part of talent onboarding.</Banner>;
  const [cfg, onboarding] = await Promise.all([getWelcomeVideoConfig(prisma), onboardingFor(prisma, actor)]);
  const src = cfg.storageKey ? "/api/onboarding/welcome-video/file" : cfg.videoUrl;
  const done = onboarding.video.completedAt;

  return (
    <>
      <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-500 hover:text-ink-900"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
      <PageHeader eyebrow="Onboarding" title={cfg.title} description={onboarding.video.required ? `Required before the Academy unlocks. Watch at least ${cfg.requiredPercent}% to complete this step.` : "Optional for your account, but worth the time."} />
      {!cfg.enabled || !src ? (
        <Card><p className="text-[14px] text-ink-500">The welcome video is not available yet. Check back soon.</p></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
          <Card>
            <WelcomeVideoPlayer src={src} title={cfg.title} requiredPercent={cfg.requiredPercent} initialPercent={onboarding.video.percent} initialPositionSec={onboarding.video.lastPositionSec} initialCompleted={!!done} completedAt={done} />
          </Card>
          <div className="space-y-5">
            {cfg.instructions && <Card title="Before you start"><div className="space-y-3 text-[14px] leading-relaxed text-ink-700">{renderMarkdown(cfg.instructions)}</div></Card>}
            <Card title={done ? "Step completed" : "What happens next"}>
              {done ? (
                <>
                  <p className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-700"><CheckCircle2 className="h-4 w-4" /> Completed {fmtDate(done)}</p>
                  <p className="mt-2 text-[13.5px] text-ink-500">{onboarding.done ? "Your onboarding is complete." : "One more step on your checklist and you are done."}</p>
                  <Link href={onboarding.done ? "/courses" : "/dashboard"} className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-full bg-ink-900 px-4 text-[13.5px] font-semibold text-white hover:bg-ink-800">{onboarding.done ? "Open the Academy" : "Back to checklist"} <ArrowRight className="h-4 w-4" /></Link>
                </>
              ) : (
                <ol className="space-y-2 text-[13.5px] text-ink-600">
                  <li>1. Watch the video. Pausing is fine; skipping ahead is not counted.</li>
                  <li>2. The step completes automatically at {cfg.requiredPercent}%.</li>
                  <li>3. {onboarding.coursesLocked ? "The Academy courses unlock right away." : "Return to your dashboard checklist."}</li>
                </ol>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
