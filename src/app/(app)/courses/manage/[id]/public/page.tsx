import type { Metadata } from "next";
import { prisma } from "@/server/db/client";
import { Card } from "@/components/app/ui";
import { PublicDetailsForm, FeaturedForm, ReviewModeration } from "@/components/academy/PublicDetailsForm";
import { getPublicDetails } from "@/server/services/public-course.service";
import { listReviewsForStaff, courseRatingSummary } from "@/server/services/review.service";
import { loadBuilderCourse } from "../load";

export const metadata: Metadata = { title: "Public page" };

export default async function PublicPageTab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await loadBuilderCourse(id);
  const isAdmin = actor.permissions.has("course.manage");
  const [details, rating, reviews] = await Promise.all([getPublicDetails(prisma, actor, id), courseRatingSummary(prisma, id), isAdmin ? listReviewsForStaff(prisma, actor, id) : Promise.resolve([])]);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <Card title="Public course page" description="What visitors read before they buy: the address, the pitch, what they will learn, and whether the course is listed in the catalog.">
        <PublicDetailsForm details={details} isAdmin={isAdmin} />
      </Card>
      <div className="space-y-5">
        <Card title="Reviews" description={rating.count ? `${rating.average} out of 5 from ${rating.count} review${rating.count === 1 ? "" : "s"}` : "No reviews yet"}>
          {isAdmin ? <ReviewModeration courseId={id} reviews={reviews} /> : <p className="text-[13.5px] text-ink-500">Learners with access to a published course can review it. Admin can hide a review that breaks the rules.</p>}
        </Card>
        {isAdmin && (
          <Card title="Featured">
            <FeaturedForm courseId={id} rank={details.featuredRank} canFeature={details.status === "PUBLISHED" && details.listing === "LISTED"} />
          </Card>
        )}
      </div>
    </div>
  );
}
