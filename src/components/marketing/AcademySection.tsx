import { ArrowRight, BookOpen, ClipboardCheck, UserCheck, Award, UserSquare2 } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";
import { Button } from "@/components/ui/Button";
import { courses } from "@/lib/site";

const pipeline = [
  { icon: BookOpen, label: "Course completion" },
  { icon: ClipboardCheck, label: "Assessment" },
  { icon: UserCheck, label: "Coach review" },
  { icon: Award, label: "Certification" },
  { icon: UserSquare2, label: "Connect profile" },
];

export function AcademySection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="container-x">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="Hirewise VA Academy"
              title={
                <>
                  Training that flows <span className="font-serif font-normal italic text-brand-600">straight into the profile.</span>
                </>
              }
              description="Courses are built by Hirewise coaches. When an agent completes a course and passes the assessment, the certification is added to their Connect profile automatically. No manual claims, no copy-pasted badges."
            />
            <div className="mt-8 flex flex-wrap gap-2">
              {courses.map((c) => (
                <span
                  key={c}
                  className="rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-[13px] font-medium text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-8">
              <Button href="/academy" variant="dark">
                Explore the Academy <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Reveal>
            <div className="rounded-3xl border border-ink-100 bg-gradient-to-b from-white to-ink-50 p-6 shadow-soft sm:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">Certification pipeline</p>
              <ol className="mt-5 space-y-3">
                {pipeline.map((p, i) => (
                  <li key={p.label} className="flex items-center gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-soft ring-1 ring-ink-100">
                      <p.icon className="h-5 w-5" />
                    </span>
                    <div className="flex-1">
                      <p className="text-[15px] font-semibold text-ink-800">{p.label}</p>
                    </div>
                    {i < pipeline.length - 1 ? (
                      <span className="text-[12px] font-semibold text-ink-300">then</span>
                    ) : (
                      <span className="rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-bold text-white">Automatic</span>
                    )}
                  </li>
                ))}
              </ol>
              <div className="mt-6 rounded-2xl bg-ink-900 p-4 text-[13.5px] leading-relaxed text-ink-200">
                <span className="font-semibold text-white">Rule:</span> certifications originate only from the Academy or
                authorised Hirewise personnel. Agents cannot add one themselves.
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
