import { getStorage } from "@/server/adapters/storage";
import { COVER_URL_TTL_SECONDS } from "@/lib/course-cover";

/**
 * Signed delivery of course covers. The storage key never leaves the server: callers pass course rows they were
 * already authorized to read (published courses for talent, assigned or managed courses for coaches and Admin) and
 * get back a map of course id to a signed GET link. A failure to sign one cover only drops that cover.
 */
export async function coverUrlsFor(courses: Array<{ id: string; thumbnailKey: string | null }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const withCover = courses.filter((c): c is { id: string; thumbnailKey: string } => !!c.thumbnailKey);
  if (withCover.length === 0) return out;
  const storage = getStorage();
  await Promise.all(
    withCover.map(async (c) => {
      try {
        out.set(c.id, await storage.createDownloadUrl(c.thumbnailKey, COVER_URL_TTL_SECONDS));
      } catch {
        // The generated cover is shown instead.
      }
    }),
  );
  return out;
}

export async function coverUrlFor(course: { id: string; thumbnailKey: string | null }): Promise<string | null> {
  return (await coverUrlsFor([course])).get(course.id) ?? null;
}
