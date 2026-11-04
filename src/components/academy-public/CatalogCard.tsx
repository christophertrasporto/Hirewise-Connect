import { Clock, PlayCircle, Users } from "lucide-react";
import { CourseTile } from "@/components/academy/CourseTile";
import { StarRating } from "./StarRating";
import type { PublicCourseCard } from "@/server/views/public-academy.views";

/** One course in the public catalog, a category page, a coach page, or the related-courses row. */
export function CatalogCard({ course }: { course: PublicCourseCard }) {
  const coach = course.coaches.map((c) => c.name).slice(0, 2).join(", ");
  return (
    <CourseTile
      href={course.href}
      cover={{ title: course.title, category: course.category, difficulty: course.difficulty, coverUrl: course.coverUrl }}
      pill={course.hasPreview ? { label: "Free preview", tone: "good", icon: <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> } : null}
      title={course.title}
      description={course.summary}
      footer={
        <div className="space-y-2.5">
          {coach && <p className="truncate text-[12.5px] text-ink-500">By {coach}</p>}
          <StarRating value={course.ratingAverage} count={course.ratingCount} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-500">
            <span>{course.difficulty.charAt(0) + course.difficulty.slice(1).toLowerCase()}</span>
            <span>{course.lessonCount} lesson{course.lessonCount === 1 ? "" : "s"}</span>
            {course.durationLabel && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {course.durationLabel}
              </span>
            )}
            {course.enrolled !== null && course.enrolled > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden="true" /> {course.enrolled.toLocaleString("en-US")}
              </span>
            )}
          </div>
          <p className="font-display text-[16px] font-extrabold text-ink-900">{course.priceLabel}</p>
        </div>
      }
    />
  );
}

export function CatalogGrid({ courses }: { courses: PublicCourseCard[] }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((c) => (
        <li key={c.id} className="flex">
          <div className="flex w-full flex-col [&>a]:h-full">
            <CatalogCard course={c} />
          </div>
        </li>
      ))}
    </ul>
  );
}
