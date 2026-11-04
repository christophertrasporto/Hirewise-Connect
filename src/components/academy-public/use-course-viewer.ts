"use client";

import { useEffect, useState } from "react";
import type { CourseViewer } from "@/server/services/public-catalog.service";

const inflight = new Map<string, Promise<CourseViewer | null>>();

function load(courseId: string): Promise<CourseViewer | null> {
  let p = inflight.get(courseId);
  if (!p) {
    p = fetch(`/api/academy/viewer?courseId=${encodeURIComponent(courseId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CourseViewer>) : null))
      .catch(() => null)
      .finally(() => setTimeout(() => inflight.delete(courseId), 1000));
    inflight.set(courseId, p);
  }
  return p;
}

/**
 * Who is looking at this course page. The cached page is the same for everyone and shows the signed-out version; this
 * asks the no-store viewer route once the page is up and returns the visitor's own state (or null while it loads or if
 * it fails, in which case the signed-out version simply stays).
 */
export function useCourseViewer(courseId: string): CourseViewer | null {
  const [viewer, setViewer] = useState<CourseViewer | null>(null);
  useEffect(() => {
    let live = true;
    void load(courseId).then((v) => live && setViewer(v));
    return () => {
      live = false;
    };
  }, [courseId]);
  return viewer;
}
