import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireActor } from "@/server/auth/require-actor";
import { getCourseForCoach } from "@/server/services/academy.service";
import { NotFoundError } from "@/server/policies/authorize";

/** One course load per request, shared by the builder layout and its tab pages. */
export const loadBuilderCourse = cache(async (id: string) => {
  const actor = await requireActor();
  try {
    const data = await getCourseForCoach(prisma, actor, id);
    return { actor, ...data };
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
});

export type BuilderCourse = Awaited<ReturnType<typeof loadBuilderCourse>>["course"];
