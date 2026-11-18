import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { testDb, resetDb } from "../setup/db";
import { createCourse, publishCourse, enrol, catalogForAgent, courseWarnings } from "@/server/services/academy.service";
import { setPartnerLink, partnerDestination, partnerClickCounts } from "@/server/services/partner-course.service";
import { getCatalog, getPublicCoursePage, getCourseViewer } from "@/server/services/public-catalog.service";
import { startPurchase } from "@/server/services/purchase.service";
import { redeemAccessCode } from "@/server/services/access-code.service";
import { resetEnvCache } from "@/server/env";
import { makeActor } from "@/server/auth/actor";
import { ForbiddenError } from "@/server/policies/authorize";
import { ROLE_NAMES, type RoleKey } from "@/server/policies/permissions";
import { DEFAULT_CATALOG_QUERY, type CatalogQuery } from "@/lib/public-catalog";
import { GET as go } from "@/app/go/[slug]/route";

// The route reads the session cookie; a signed-out visitor has none.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

const db = testDb();
const ids: Record<string, string> = {};
const profiles: Record<string, string> = {};
let categoryId = "";
const LINK = "https://www.example-learning.com/course/closing-mastery?aff=hirewise-77";

const admin = () => makeActor("ADMIN", { userId: ids.admin });
const sales = () => makeActor("SALES", { userId: ids.sales });
const coach = () => makeActor("COACH", { userId: ids.coach });
const learner = () => makeActor("AGENT", { userId: ids.learner, agentProfileId: profiles.learner });
const q = (over: Partial<CatalogQuery> = {}): CatalogQuery => ({ ...DEFAULT_CATALOG_QUERY, ...over });

async function mkUser(key: string, email: string, role: RoleKey) {
  const u = await db.user.create({ data: { email, roleId: (await db.role.findUniqueOrThrow({ where: { key: role } })).id, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  if (role === "AGENT") profiles[key] = (await db.agentProfile.create({ data: { userId: u.id, displayName: key, headline: "H", primaryRole: "Cold Caller", status: "APPROVED", availabilityStatus: "AVAILABLE", timezone: "Asia/Manila", approvedAt: new Date() } })).id;
}

const input = (title: string) => ({ title, categoryId, description: "A course description long enough to satisfy validation rules.", difficulty: "BEGINNER" as const, price: "", passingScore: 70 });

/** A draft course with a published module, one published welcome video (uploaded, free preview) and a cover. */
async function course(title: string, o: { welcome?: boolean; cover?: boolean } = {}) {
  const id = await createCourse(db, admin(), input(title));
  const m = await db.courseModule.create({ data: { courseId: id, order: 1, title: "Module 1", status: "PUBLISHED" } });
  await db.courseLesson.create({ data: { moduleId: m.id, order: 1, title: "Lesson 1", contentType: "TEXT", body: "Secret gated text", status: "PUBLISHED" } });
  if (o.welcome !== false) await db.courseLesson.create({ data: { moduleId: m.id, order: 0, title: "Welcome", contentType: "VIDEO", storageKey: `lessons/${id}/w.mp4`, fileName: "w.mp4", status: "PUBLISHED", isFreePreview: true, isRequired: false } });
  if (o.cover !== false) await db.academyCourse.update({ where: { id }, data: { thumbnailKey: `courses/${id}/cover/c.png` } });
  return id;
}
const slugOf = async (id: string) => (await db.academyCourse.findUniqueOrThrow({ where: { id } })).slug;
const clicks = (id: string) => db.externalCourseClick.count({ where: { courseId: id } });
const goReq = (slug: string, headers: Record<string, string> = {} as Record<string, string>) => new NextRequest(`http://localhost:3000/go/${slug}`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120", ...headers } });

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.AUTH_SECRET = "test-auth-secret-at-least-16";
  resetEnvCache();
  await resetDb(db);
  for (const key of Object.keys(ROLE_NAMES) as RoleKey[]) await db.role.create({ data: { key, name: ROLE_NAMES[key].name } });
  await mkUser("admin", "admin@hirewise.example", "ADMIN");
  await mkUser("sales", "sales@hirewise.example", "SALES");
  await mkUser("coach", "coach@hirewise.example", "COACH");
  await mkUser("learner", "learner@talent.example", "AGENT");
  categoryId = (await db.courseCategory.create({ data: { name: "Sales", slug: "sales", order: 1 } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("setting the partner link", () => {
  it("only an Admin can set, change or clear it; sales and coaches cannot", async () => {
    const id = await course("Who can set");
    for (const actor of [sales(), coach()]) await expect(setPartnerLink(db, actor, id, { url: LINK, provider: "Udemy" })).rejects.toBeInstanceOf(ForbiddenError);
    await setPartnerLink(db, admin(), id, { url: LINK, provider: "Udemy", priceLabel: "from $19" });
    const c = await db.academyCourse.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ externalUrl: LINK, externalProvider: "Udemy", externalPriceLabel: "from $19" });
    await expect(setPartnerLink(db, coach(), id, null)).rejects.toBeInstanceOf(ForbiddenError);
    await setPartnerLink(db, admin(), id, null);
    expect(await db.academyCourse.findUniqueOrThrow({ where: { id } })).toMatchObject({ externalUrl: null, externalProvider: null, externalPriceLabel: null });
    const a = await db.auditLog.findFirst({ where: { entityId: id, action: "COURSE_UPDATED" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(a)).not.toContain("example-learning");
  });

  it("refuses an unsafe or unusable link and a missing partner name", async () => {
    const id = await course("Bad links");
    const bad = ["http://www.example-learning.com/x", "javascript:alert(1)", "data:text/html,hi", "https://user:pass@www.example-learning.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://intranet/x", "https://localhost:3000/academy", "not a link", ""];
    for (const url of bad) await expect(setPartnerLink(db, admin(), id, { url, provider: "Udemy" }), url).rejects.toMatchObject({ name: "UserMessageError" });
    await expect(setPartnerLink(db, admin(), id, { url: LINK, provider: "  " })).rejects.toMatchObject({ name: "UserMessageError" });
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id } })).externalUrl).toBeNull();
  });

  it("a course that already has learners cannot become a partner course", async () => {
    const id = await course("Has learners");
    await db.courseEnrollment.create({ data: { courseId: id, agentProfileId: profiles.learner, priceCents: 0, paymentStatus: "NOT_REQUIRED" } });
    await expect(setPartnerLink(db, admin(), id, { url: LINK, provider: "Udemy" })).rejects.toThrow(/already has learners/);
  });
});

describe("going live", () => {
  it("a partner course needs its welcome video, its partner name and a cover, like the plan says", async () => {
    const noVideo = await course("No video", { welcome: false });
    await setPartnerLink(db, admin(), noVideo, { url: LINK, provider: "Udemy" });
    await expect(publishCourse(db, admin(), noVideo, {})).rejects.toThrow(/no welcome video/);

    const noCover = await course("No cover", { cover: false });
    await setPartnerLink(db, admin(), noCover, { url: LINK, provider: "Udemy" });
    await expect(publishCourse(db, admin(), noCover, {})).rejects.toThrow(/cover image/);

    const ok = await course("Ready partner");
    await setPartnerLink(db, admin(), ok, { url: LINK, provider: "Udemy", priceLabel: "USD 49" });
    await publishCourse(db, admin(), ok, {});
    expect((await db.academyCourse.findUniqueOrThrow({ where: { id: ok } })).status).toBe("PUBLISHED");
  });

  it("the builder warns about a missing cover on a draft partner course", () => {
    const base = { status: "DRAFT", externalUrl: LINK, externalProvider: "Udemy", modules: [{ status: "PUBLISHED", lessons: [{ status: "PUBLISHED", isFreePreview: true, contentType: "VIDEO", storageKey: "k" }] }] };
    expect(courseWarnings({ ...base, hasCover: false }).join(" ")).toMatch(/cover image/);
    expect(courseWarnings({ ...base, hasCover: true })).toEqual([]);
  });
});

describe("nothing is sold or enrolled here", () => {
  let id = "";
  beforeAll(async () => {
    id = await course("Taught elsewhere");
    await setPartnerLink(db, admin(), id, { url: LINK, provider: "Udemy", priceLabel: "from $19" });
    await publishCourse(db, admin(), id, {});
  });

  it("enrolling, the checkout, access codes and course seats all refuse a partner course", async () => {
    await expect(enrol(db, learner(), id)).rejects.toThrow(/taught on Udemy/);
    await expect(startPurchase(db, learner(), { courseId: id, method: "PAYPAL" })).rejects.toThrow(/taught on Udemy/);
    expect(await db.courseEnrollment.count({ where: { courseId: id } })).toBe(0);
    await db.accessCode.create({ data: { code: "PARTNER-TEST-0001", courseId: id, paymentReference: "REF-1", expiresAt: new Date(Date.now() + 86_400_000), createdById: ids.admin } });
    await expect(redeemAccessCode(db, learner(), "PARTNER-TEST-0001")).rejects.toThrow(/access code/i);
    expect((await db.accessCode.findUniqueOrThrow({ where: { code: "PARTNER-TEST-0001" } })).status).toBe("UNUSED");
    expect(await db.courseEnrollment.count({ where: { courseId: id } })).toBe(0);
  });

  it("the signed-in learner list shows it as a partner course with the go path, never the link", async () => {
    const list = await catalogForAgent(db, learner());
    const mine = list.find((c) => c.id === id)!;
    expect(mine.partner).toMatchObject({ provider: "Udemy", priceLabel: "from $19", goPath: `/go/${await slugOf(id)}` });
    expect(JSON.stringify(list)).not.toContain("example-learning");
    expect(JSON.stringify(list)).not.toContain("aff=");
  });
});

describe("the public pages", () => {
  let id = "";
  let slug = "";
  beforeAll(async () => {
    id = await course("Closing Mastery for Agency Sales Team");
    await setPartnerLink(db, admin(), id, { url: LINK, provider: "Udemy", priceLabel: "from $19" });
    await publishCourse(db, admin(), id, {});
    slug = await slugOf(id);
  });

  it("the course page names the partner, shows the typed price and the go path, and never the link", async () => {
    const r = await getPublicCoursePage(db, slug);
    if (!r || r.type !== "FOUND") throw new Error("not found");
    const c = r.course;
    expect(c.partner).toEqual({ provider: "Udemy", goPath: `/go/${slug}` });
    expect(c.priceLabel).toBe("from $19");
    expect(c.curriculum).toEqual([]);
    expect(c.lessonCount).toBe(0);
    expect(c.enrolled).toBeNull();
    // the welcome video is the only playable thing, and a gated lesson never carries its text
    expect(c.previews.map((p) => p.title)).toEqual(["Welcome"]);
    expect(JSON.stringify(r)).not.toContain("example-learning");
    expect(JSON.stringify(r)).not.toContain("Secret gated text");
    expect(JSON.stringify(r)).not.toContain("aff=");
  });

  it("the catalog card is a partner card, is not counted as free, and sorts last by price", async () => {
    const all = await getCatalog(db, q(), { withFeatured: false });
    const card = all.cards.find((c) => c.title.startsWith("Closing Mastery"))!;
    expect(card.partner).toEqual({ provider: "Udemy", goPath: `/go/${slug}` });
    expect(card.priceLabel).toBe("from $19");
    expect(card.lessonCount).toBe(0);
    expect(JSON.stringify(all)).not.toContain("example-learning");
    const free = await getCatalog(db, q({ price: "free" }), { withFeatured: false });
    expect(free.cards.some((c) => c.partner)).toBe(false);
    const low = await getCatalog(db, q({ sort: "price-low" }), { withFeatured: false });
    expect(low.cards.at(-1)?.partner).not.toBeNull();
  });

  it("every visitor gets the same answer from the viewer endpoint's service: Take this course", async () => {
    expect(await getCourseViewer(db, null, id)).toMatchObject({ partner: true, state: "SIGNED_OUT" });
    expect(await getCourseViewer(db, learner(), id)).toMatchObject({ partner: true, state: "NOT_TALENT", myReview: null });
  });
});

describe("the Take this course button (/go/<slug>)", () => {
  let id = "";
  let slug = "";
  beforeAll(async () => {
    id = await course("Clicked course");
    await setPartnerLink(db, admin(), id, { url: LINK, provider: "Udemy" });
    await publishCourse(db, admin(), id, {});
    slug = await slugOf(id);
  });

  it("redirects to the affiliate link with no caching, and counts one press (with who, when signed in)", async () => {
    const before = await clicks(id);
    const res = await go(goReq(slug), { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(LINK);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(await clicks(id)).toBe(before + 1);
    const direct = await partnerDestination(db, slug, { userId: ids.learner, ip: "198.51.100.9" });
    expect(direct).toEqual({ url: LINK });
    const last = await db.externalCourseClick.findFirstOrThrow({ where: { courseId: id }, orderBy: { createdAt: "desc" } });
    expect(last.userId).toBe(ids.learner);
  });

  it("redirects a prefetch, a crawler or a link preview without counting it", async () => {
    const before = await clicks(id);
    const quiet: Array<Record<string, string>> = [{ purpose: "prefetch" }, { "next-router-prefetch": "1" }, { "user-agent": "Googlebot/2.1" }, { "user-agent": "Slackbot-LinkExpanding 1.0" }];
    for (const headers of quiet) {
      const res = await go(goReq(slug, headers), { params: Promise.resolve({ slug }) });
      expect(res.status, JSON.stringify(headers)).toBe(302);
    }
    expect(await clicks(id)).toBe(before);
  });

  it("an unknown slug, a draft or an ordinary course is a 404 and counts nothing; a retired address redirects", async () => {
    const draft = await course("Draft partner");
    await setPartnerLink(db, admin(), draft, { url: LINK, provider: "Udemy" });
    const ordinary = await course("Ordinary course");
    await publishCourse(db, admin(), ordinary, {});
    for (const s of ["no-such-course", await slugOf(draft), await slugOf(ordinary), "Bad Slug!"]) {
      const res = await go(goReq(encodeURIComponent(s)), { params: Promise.resolve({ slug: s }) });
      expect(res.status, s).toBe(404);
    }
    expect(await clicks(draft)).toBe(0);
    expect(await clicks(ordinary)).toBe(0);
    await db.slugRedirect.create({ data: { kind: "COURSE", oldSlug: "old-clicked-course", targetId: id } });
    const moved = await go(goReq("old-clicked-course"), { params: Promise.resolve({ slug: "old-clicked-course" }) });
    expect(moved.status).toBe(308);
    expect(new URL(moved.headers.get("location")!).pathname).toBe(`/go/${slug}`);
  });

  it("staff see counts per course; other roles may not", async () => {
    const counts = await partnerClickCounts(db, admin());
    expect(counts.get(id)?.total).toBeGreaterThanOrEqual(2);
    expect(counts.get(id)?.recent).toBeGreaterThanOrEqual(2);
    for (const actor of [sales(), coach(), learner()]) await expect(partnerClickCounts(db, actor)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
