import { redirect } from "next/navigation";

/** The coach course page moved into the Course Builder. */
export default async function LegacyCoachCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/courses/manage/${id}`);
}
