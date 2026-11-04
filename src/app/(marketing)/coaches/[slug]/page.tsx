import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ChevronRight, ExternalLink, Users } from "lucide-react";
import { ReferralCapture } from "@/components/marketing/ReferralCapture";
import { CatalogGrid } from "@/components/academy-public/CatalogCard";
import { CoachAvatar } from "@/components/academy-public/CoachAvatar";
import { JsonLd } from "@/components/academy-public/JsonLd";
import { ShareButton } from "@/components/academy-public/ShareButton";
import { StarRating } from "@/components/academy-public/StarRating";
import { cachedCoachPage } from "@/app/public-academy-cache";
import { breadcrumbLd, coachLd, publicMetadata } from "@/lib/seo";

// The page reads no cookies, so it is cached and the same for everyone.
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await cachedCoachPage(slug);
  if (!r || r.type === "REDIRECT") return { title: "Coach not found", robots: { index: false } };
  const p = r.coach;
  return publicMetadata({
    title: p.headline ? `${p.displayName}, ${p.headline}` : `${p.displayName}, Hirewise coach`,
    description: p.bio || `${p.displayName} teaches ${p.courses.length} course${p.courses.length === 1 ? "" : "s"} in the Hirewise VA Academy.`,
    path: `/coaches/${p.slug}`,
    image: p.photoUrl,
    type: "profile",
  });
}

export default async function CoachPage({ params }: Props) {
  const { slug } = await params;
  const r = await cachedCoachPage(slug);
  if (!r) notFound();
  if (r.type === "REDIRECT") permanentRedirect(`/coaches/${r.slug}`);
  const p = r.coach;
  const path = `/coaches/${p.slug}`;

  return (
    <>
      <ReferralCapture />
      <JsonLd data={coachLd(p)} />
      <JsonLd data={breadcrumbLd([{ name: "VA Academy", path: "/academy" }, { name: p.displayName, path }])} />
      <section className="border-b border-ink-100 bg-hero">
        <div className="container-x py-12 lg:py-16">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-ink-500">
            <Link href="/academy" className="hover:text-ink-800">
              VA Academy
            </Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-current="page" className="font-semibold text-ink-800">
              {p.displayName}
            </span>
          </nav>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <CoachAvatar name={p.displayName} photoUrl={p.photoUrl} className="h-28 w-28 text-[2rem]" />
            <div className="min-w-0">
              <h1 className="text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] sm:text-[2.8rem]">{p.displayName}</h1>
              {p.headline && <p className="mt-2 text-[17px] text-ink-500">{p.headline}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] text-ink-600">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" aria-hidden="true" /> {p.students.toLocaleString("en-US")} learner{p.students === 1 ? "" : "s"}
                </span>
                <span>
                  {p.courses.length} course{p.courses.length === 1 ? "" : "s"}
                </span>
                <StarRating value={p.ratingAverage} count={p.ratingCount} size="md" />
              </div>
              <ShareButton path={path} title={p.displayName} personal={false} className="mt-4" />
            </div>
          </div>
        </div>
      </section>

      <div className="container-x space-y-14 py-14 lg:py-20">
        {(p.bio || p.links.length > 0) && (
          <section aria-labelledby="about-heading" className="max-w-3xl">
            <h2 id="about-heading" className="text-[1.6rem] font-bold">
              About {p.displayName}
            </h2>
            {p.bio && <p className="mt-4 whitespace-pre-line text-[15.5px] leading-relaxed text-ink-600">{p.bio}</p>}
            {p.links.length > 0 && (
              <ul className="mt-5 flex flex-wrap gap-3">
                {p.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 text-[13.5px] font-semibold text-ink-800 hover:border-ink-300">
                      {l.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section aria-labelledby="courses-heading">
          <h2 id="courses-heading" className="text-[1.6rem] font-bold">
            Courses by {p.displayName}
          </h2>
          <div className="mt-5">
            <CatalogGrid courses={p.courses} />
          </div>
        </section>
      </div>
    </>
  );
}
