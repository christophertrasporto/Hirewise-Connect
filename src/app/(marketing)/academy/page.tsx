import type { Metadata } from "next";
import { PageHero } from "@/components/marketing/PageHero";
import { CTASection } from "@/components/marketing/CTASection";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { ReferralCapture } from "@/components/marketing/ReferralCapture";
import { CatalogBody } from "@/components/academy-public/CatalogBody";
import { JsonLd } from "@/components/academy-public/JsonLd";
import { cachedCatalog, cachedCategories } from "@/app/public-academy-cache";
import { catalogHref, isUnfiltered, parseCatalogQuery } from "@/lib/public-catalog";
import { catalogLd, publicMetadata } from "@/lib/seo";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TITLE = "VA Academy: courses by Hirewise coaches";
const DESCRIPTION = "Browse courses built by Hirewise coaches. Watch free previews, learn at your pace, and add certifications to your Connect profile.";

/** Only the plain catalog (and its pages) is indexed; searches and filtered views are for people, with the plain catalog as their canonical. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const query = parseCatalogQuery(await searchParams);
  const plain = isUnfiltered(query);
  const meta = publicMetadata({ title: TITLE, description: DESCRIPTION, path: plain ? catalogHref("/academy", { page: query.page }) : "/academy", noindex: !plain });
  return { ...meta, title: query.page > 1 && plain ? `${TITLE} (page ${query.page})` : TITLE };
}

const assessment = [
  { label: "Exam score", desc: "Knowledge check with a course passing score." },
  { label: "Practical score", desc: "Task-based evaluation of real work output." },
  { label: "Roleplay score", desc: "Live mock call or scenario with a coach." },
  { label: "Communication score", desc: "Clarity, tone, and professionalism." },
  { label: "Skill assessment", desc: "Per-skill scoring that can verify profile skills." },
  { label: "Result label", desc: "Not Yet Qualified · Developing · Qualified · Advanced · Expert" },
];

export default async function AcademyPage({ searchParams }: { searchParams: SearchParams }) {
  const query = parseCatalogQuery(await searchParams);
  const plain = isUnfiltered(query);
  const [data, categories] = await Promise.all([cachedCatalog(query, plain), cachedCategories()]);

  return (
    <>
      <ReferralCapture />
      <JsonLd data={catalogLd("VA Academy", "/academy", data.cards)} />
      <PageHero
        eyebrow="Hirewise VA Academy"
        title={
          <>
            Courses by coaches. <span className="font-serif font-normal italic text-brand-600">Certifications that count.</span>
          </>
        }
        description="The Academy is where Hirewise talent is trained and assessed. Watch a free preview, pick a course, and when you pass, the certification is added to your Connect profile automatically."
      />

      <section className="py-14 lg:py-20">
        <div className="container-x">
          <CatalogBody basePath="/academy" query={query} data={data} categories={categories} />
        </div>
      </section>

      <section className="bg-ink-50/70 py-24 lg:py-32">
        <div className="container-x grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading
            eyebrow="Coach assessment"
            title="Structured scores, not star ratings"
            description="Coaches record scores across several dimensions plus written strengths and areas for improvement. The result label is configurable by Hirewise and shown to clients."
          />
          <ul className="grid gap-3 sm:grid-cols-2">
            {assessment.map((a, i) => (
              <Reveal as="li" key={a.label} delay={(i % 2) * 70}>
                <div className="h-full rounded-2xl border border-ink-100 bg-white p-5">
                  <p className="text-[15px] font-bold text-ink-900">{a.label}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-500">{a.desc}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <CTASection />
    </>
  );
}
