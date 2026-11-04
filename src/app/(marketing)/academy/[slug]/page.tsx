import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { CheckCircle2, ChevronRight, Clock, ExternalLink, FileText, Lock, PlayCircle, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { ReferralCapture } from "@/components/marketing/ReferralCapture";
import { CourseCover } from "@/components/academy/CourseTile";
import { LESSON_TYPE_META, fmtDuration } from "@/components/academy/lesson-meta";
import { embedUrl, lessonFileUrl } from "@/components/academy/LessonContent";
import { CatalogGrid } from "@/components/academy-public/CatalogCard";
import { CoachAvatar } from "@/components/academy-public/CoachAvatar";
import { CourseViewerPanel } from "@/components/academy-public/CourseViewerPanel";
import { JsonLd } from "@/components/academy-public/JsonLd";
import { PreviewPlayer } from "@/components/academy-public/PreviewPlayer";
import { ReviewBox } from "@/components/academy-public/ReviewBox";
import { StarRating } from "@/components/academy-public/StarRating";
import { cachedCoursePage } from "@/app/public-academy-cache";
import { renderMarkdown } from "@/lib/markdown";
import { breadcrumbLd, courseLd, publicMetadata } from "@/lib/seo";
import type { PreviewLesson, PublicCoursePageView } from "@/server/views/public-academy.views";
import type { LessonContentType } from "@/components/academy/lesson-meta";

// The page reads no cookies, so it is cached and the same for everyone; who is looking is loaded after the page.
export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

const INTRO_MAX = 200;

function clip(text: string, max: number): string {
  const t = text.replace(/s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await cachedCoursePage(slug);
  if (!r || r.type === "REDIRECT") return { title: "Course not found", robots: { index: false } };
  const c = r.course;
  return publicMetadata({ title: c.title, description: c.pitch || c.description, path: `/academy/${c.slug}`, image: c.coverUrl, noindex: c.unlisted });
}

/** How a preview video plays: our own lesson route for an upload, the provider embed for a hosted link, or null (an external link instead). */
function videoSource(l: PreviewLesson): { kind: "file" | "embed"; src: string } | null {
  if (l.hasFile) return { kind: "file", src: lessonFileUrl(l.id) };
  const embed = l.url ? embedUrl(l.url) : null;
  return embed ? { kind: "embed", src: `${embed}${embed.includes("?") ? "&" : "?"}autoplay=1` } : null;
}

function Poster({ c }: { c: PublicCoursePageView }) {
  return <CourseCover title={c.title} category={c.category} difficulty={c.difficulty} coverUrl={c.coverUrl} eager className="rounded-3xl" />;
}

function PreviewItem({ lesson, course }: { lesson: PreviewLesson; course: PublicCoursePageView }) {
  const src = lesson.contentType === "VIDEO" ? videoSource(lesson) : null;
  return (
    <li className="rounded-2xl border border-ink-100 bg-white p-4">
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-3">
          <PlayCircle className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-ink-900">{lesson.title}</span>
            <span className="block text-[12.5px] text-ink-400">
              {LESSON_TYPE_META[lesson.contentType as LessonContentType].label}
              {lesson.durationSec ? ` · ${fmtDuration(lesson.durationSec)}` : ""}
            </span>
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          {lesson.description && <p className="text-[13.5px] text-ink-500">{lesson.description}</p>}
          {lesson.contentType === "VIDEO" && src && <PreviewPlayer title={lesson.title} source={src} poster={<Poster c={course} />} />}
          {lesson.contentType === "VIDEO" && !src && lesson.url && (
            <a href={lesson.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-600 hover:text-brand-700">
              Watch the video <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          {lesson.contentType === "AUDIO" && lesson.hasFile && <audio controls preload="none" src={lessonFileUrl(lesson.id)} className="w-full" />}
          {lesson.contentType === "TEXT" && lesson.body && <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-700">{renderMarkdown(lesson.body)}</div>}
          {lesson.contentType === "DOCUMENT" && lesson.hasFile && (
            <a href={lessonFileUrl(lesson.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-ink-200 bg-white px-4 py-3 text-[14px] font-semibold text-ink-800 hover:border-brand-300 hover:text-brand-700">
              <FileText className="h-4 w-4 text-brand-600" aria-hidden="true" /> {lesson.fileName ?? "Open document"}
            </a>
          )}
          {lesson.contentType === "LINK" && lesson.url && (
            <a href={lesson.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all text-[14px] font-semibold text-brand-600 hover:text-brand-700">
              {lesson.url.replace(/^https?:\/\//, "")} <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          )}
        </div>
      </details>
    </li>
  );
}

export default async function PublicCoursePage({ params }: Props) {
  const { slug } = await params;
  const r = await cachedCoursePage(slug);
  if (!r) notFound();
  if (r.type === "REDIRECT") permanentRedirect(`/academy/${r.slug}`);
  const c = r.course;

  const hero = c.previews.find((p) => p.contentType === "VIDEO" && (p.hasFile || p.url));
  const heroSource = hero ? videoSource(hero) : null;
  const otherPreviews = c.previews.filter((p) => p.id !== (heroSource ? hero?.id : undefined));
  // With no pitch, the hero shows the start of the description and the About section carries the rest (only when there is more).
  const intro = c.pitch || clip(c.description, INTRO_MAX);
  const showAbout = !!c.pitch || c.description.length > INTRO_MAX;
  const level = c.difficulty.charAt(0) + c.difficulty.slice(1).toLowerCase();
  const crumbs = [{ name: "VA Academy", path: "/academy" }, ...(c.categorySlug ? [{ name: c.category, path: `/academy/category/${c.categorySlug}` }] : []), { name: c.title, path: `/academy/${c.slug}` }];

  return (
    <>
      <ReferralCapture />
      <JsonLd data={courseLd({ slug: c.slug, title: c.title, description: c.pitch || c.description, difficulty: c.difficulty, priceCents: c.priceCents, currency: c.currency, image: c.coverUrl, ratingAverage: c.ratingAverage, ratingCount: c.ratingCount, coaches: c.coaches })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      {c.faq.length > 0 && <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: c.faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }} />}

      <section className="relative overflow-hidden border-b border-ink-100 bg-hero">
        <div className="container-x relative grid gap-10 py-10 lg:grid-cols-[1.25fr_0.75fr] lg:py-14">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-500">
              <Link href="/academy" className="hover:text-ink-800">
                VA Academy
              </Link>
              {c.categorySlug && (
                <>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <Link href={`/academy/category/${c.categorySlug}`} className="hover:text-ink-800">
                    {c.category}
                  </Link>
                </>
              )}
            </nav>
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-500">
              <Badge>{c.category}</Badge>
              <span>{level}</span>
              {c.durationLabel && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {c.durationLabel}
                </span>
              )}
            </div>
            <h1 className="mt-4 text-[2.1rem] font-extrabold leading-[1.06] tracking-[-0.03em] sm:text-[2.8rem]">{c.title}</h1>
            <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-ink-500">{intro}</p>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-ink-600">
              <StarRating value={c.ratingAverage} count={c.ratingCount} size="md" />
              {c.enrolled !== null && c.enrolled > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" aria-hidden="true" /> {c.enrolled.toLocaleString("en-US")} learner{c.enrolled === 1 ? "" : "s"}
                </span>
              )}
              {c.coaches.length > 0 && (
                <span>
                  By{" "}
                  {c.coaches.map((p, i) => (
                    <span key={p.name}>
                      {i > 0 ? ", " : ""}
                      {p.slug ? (
                        <Link href={`/coaches/${p.slug}`} className="font-semibold text-brand-700 hover:text-brand-800">
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                    </span>
                  ))}
                </span>
              )}
            </div>

            <div className="mt-8">
              {hero && heroSource ? (
                <>
                  <p className="mb-3 inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-brand-700">
                    <PlayCircle className="h-4 w-4" aria-hidden="true" /> Free preview, no account needed
                  </p>
                  <PreviewPlayer title={hero.title} source={heroSource} poster={<Poster c={c} />} />
                </>
              ) : (
                <Poster c={c} />
              )}
            </div>
          </div>

          <CourseViewerPanel course={{ id: c.id, slug: c.slug, title: c.title, priceCents: c.priceCents, priceLabel: c.priceLabel, lessonCount: c.lessonCount, previewCount: c.previewCount, certification: c.certification }} />
        </div>
      </section>

      <div className="container-x grid gap-14 py-14 pb-28 lg:grid-cols-[1.25fr_0.75fr] lg:py-20 lg:pb-20">
        <div className="min-w-0 space-y-14">
          {c.learningPoints.length > 0 && (
            <section aria-labelledby="learn-heading">
              <h2 id="learn-heading" className="text-[1.6rem] font-bold">
                What you will learn
              </h2>
              <ul className="mt-5 grid gap-3 rounded-3xl border border-ink-100 bg-white p-6 sm:grid-cols-2">
                {c.learningPoints.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-[14.5px] text-ink-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" /> {p}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {showAbout && (
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="text-[1.6rem] font-bold">
                About this course
              </h2>
              <p className="mt-4 whitespace-pre-line text-[15.5px] leading-relaxed text-ink-600">{c.description}</p>
            </section>
          )}

          <section aria-labelledby="curriculum-heading">
            <h2 id="curriculum-heading" className="text-[1.6rem] font-bold">
              What is in this course
            </h2>
            <p className="mt-1 text-[13.5px] text-ink-500">
              {c.curriculum.length} module{c.curriculum.length === 1 ? "" : "s"} · {c.lessonCount} lesson{c.lessonCount === 1 ? "" : "s"}
              {c.durationLabel ? ` · ${c.durationLabel}` : ""}
            </p>
            <ol className="mt-6 space-y-6">
              {c.curriculum.map((m, i) => (
                <li key={m.id}>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Module {i + 1}</p>
                  <p className="text-[16px] font-bold text-ink-900">{m.title}</p>
                  <ul className="mt-2 divide-y divide-ink-100 rounded-2xl border border-ink-100 bg-white">
                    {m.lessons.map((l) => {
                      const Icon = LESSON_TYPE_META[l.contentType as LessonContentType].icon;
                      return (
                        <li key={l.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
                          <Icon className="h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-ink-800">{l.title}</span>
                          {l.durationSec ? <span className="text-[12.5px] text-ink-400">{fmtDuration(l.durationSec)}</span> : null}
                          {l.isFreePreview ? (
                            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">Free preview</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[12px] text-ink-400" title="Included when you buy the course">
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                              Locked
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </section>

          {otherPreviews.length > 0 && (
            <section aria-labelledby="previews-heading">
              <h2 id="previews-heading" className="text-[1.6rem] font-bold">
                More free lessons
              </h2>
              <ul className="mt-5 space-y-3">
                {otherPreviews.map((p) => (
                  <PreviewItem key={p.id} lesson={p} course={c} />
                ))}
              </ul>
            </section>
          )}

          {c.audience && (
            <section aria-labelledby="audience-heading">
              <h2 id="audience-heading" className="text-[1.6rem] font-bold">
                Who this course is for
              </h2>
              <p className="mt-4 whitespace-pre-line text-[15.5px] leading-relaxed text-ink-600">{c.audience}</p>
            </section>
          )}

          {c.requirements && (
            <section aria-labelledby="requirements-heading">
              <h2 id="requirements-heading" className="text-[1.6rem] font-bold">
                Requirements
              </h2>
              <p className="mt-4 whitespace-pre-line text-[15.5px] leading-relaxed text-ink-600">{c.requirements}</p>
            </section>
          )}

          {c.coaches.length > 0 && (
            <section aria-labelledby="coach-heading">
              <h2 id="coach-heading" className="text-[1.6rem] font-bold">
                {c.coaches.length === 1 ? "Your coach" : "Your coaches"}
              </h2>
              <ul className="mt-5 space-y-4">
                {c.coaches.map((p) => (
                  <li key={p.name} className="flex gap-4 rounded-3xl border border-ink-100 bg-white p-5">
                    <CoachAvatar name={p.name} photoUrl={p.photoUrl} />
                    <div className="min-w-0">
                      <p className="text-[16px] font-bold text-ink-900">
                        {p.slug ? (
                          <Link href={`/coaches/${p.slug}`} className="hover:text-brand-700">
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                      </p>
                      {p.headline && <p className="text-[13.5px] text-ink-500">{p.headline}</p>}
                      {p.bio && <p className="mt-2 line-clamp-4 whitespace-pre-line text-[14px] leading-relaxed text-ink-600">{p.bio}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="reviews-heading">
            <h2 id="reviews-heading" className="text-[1.6rem] font-bold">
              Reviews
            </h2>
            <div className="mt-2">
              <StarRating value={c.ratingAverage} count={c.ratingCount} size="md" />
            </div>
            <div className="mt-5 space-y-4">
              <ReviewBox courseId={c.id} />
              {c.reviews.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-ink-200 bg-white px-5 py-8 text-center text-[14px] text-ink-500">No reviews yet. Learners who own this course can leave the first one.</p>
              ) : (
                <ul className="space-y-3">
                  {c.reviews.map((rev) => (
                    <li key={rev.id} className="rounded-2xl border border-ink-100 bg-white p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[14.5px] font-semibold text-ink-900">{rev.author}</p>
                        <time dateTime={rev.createdAt} className="text-[12.5px] text-ink-400">
                          {new Date(rev.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}
                        </time>
                      </div>
                      <StarRating value={rev.rating} className="mt-1" />
                      {rev.body && <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-ink-600">{rev.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="refund-heading" className="rounded-3xl border border-ink-100 bg-ink-50/60 p-6">
            <h2 id="refund-heading" className="inline-flex items-center gap-2 text-[1.2rem] font-bold">
              <ShieldCheck className="h-5 w-5 text-brand-600" aria-hidden="true" /> Refunds
            </h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-600">
              Course payments and refunds follow the Hirewise Connect{" "}
              <Link href="/legal/terms" className="font-semibold text-brand-700 hover:text-brand-800">
                Terms
              </Link>
              . Watch the free preview first, and{" "}
              <Link href="/contact" className="font-semibold text-brand-700 hover:text-brand-800">
                contact us
              </Link>{" "}
              if you have a question before you buy.
            </p>
          </section>

          {c.faq.length > 0 && (
            <section aria-labelledby="faq-heading">
              <h2 id="faq-heading" className="text-[1.6rem] font-bold">
                Frequently asked questions
              </h2>
              <div className="mt-5 divide-y divide-ink-100 rounded-3xl border border-ink-100 bg-white">
                {c.faq.map((f) => (
                  <details key={f.question} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-ink-900">
                      {f.question}
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-400 transition group-open:rotate-90" aria-hidden="true" />
                    </summary>
                    <p className="mt-3 whitespace-pre-line text-[14.5px] leading-relaxed text-ink-600">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {c.related.length > 0 && (
            <section aria-labelledby="related-heading">
              <h2 id="related-heading" className="text-[1.6rem] font-bold">
                Related courses
              </h2>
              <div className="mt-5">
                <CatalogGrid courses={c.related} />
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
