import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { RETURN_COOKIE, RETURN_COOKIE_MAX_AGE, safeReturnPath, startReturnHref } from "@/lib/return-to";
import { GET as start } from "@/app/api/return/start/route";
import { GET as cont } from "@/app/api/return/continue/route";

const ID = "cmucvzzlr004kf6es09iugigc";
const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie: `${RETURN_COOKIE}=${cookie}` } } : undefined);
const location = (res: Response) => new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;

describe("which paths can be remembered", () => {
  it("accepts a course page, public or in the app, and returns the learner's course page", () => {
    expect(safeReturnPath(`/courses/${ID}`)).toBe(`/courses/${ID}`);
    expect(safeReturnPath(`/academy/courses/${ID}`)).toBe(`/courses/${ID}`);
    expect(safeReturnPath(`  /courses/${ID}  `)).toBe(`/courses/${ID}`);
  });

  it("drops query strings and fragments", () => {
    expect(safeReturnPath(`/academy/courses/${ID}?ref=ABC-123456`)).toBe(`/courses/${ID}`);
    expect(safeReturnPath(`/courses/${ID}#lessons`)).toBe(`/courses/${ID}`);
  });

  it("refuses everything that is not exactly a course page, so it can never be an open redirect", () => {
    const bad = [
      "https://evil.example/courses/" + ID,
      "//evil.example/courses/" + ID,
      "/\\evil.example",
      "/dashboard",
      "/staff/users",
      "/courses",
      "/courses/",
      "/courses/short",
      `/courses/${ID}/lessons/abc`,
      `/courses/${ID}/../../staff`,
      `/courses/..%2F..%2Fstaff`,
      `/courses/${ID}%0d%0aSet-Cookie:x=1`,
      `/courses/${"a".repeat(41)}`,
      `/api/auth/logout`,
      "javascript:alert(1)",
      "",
      "   ",
    ];
    for (const b of bad) expect(safeReturnPath(b), JSON.stringify(b)).toBeNull();
    for (const nonString of [null, undefined, 5, {}, []]) expect(safeReturnPath(nonString)).toBeNull();
  });

  it("builds the link the course page uses", () => {
    expect(startReturnHref(ID, "register")).toBe(`/api/return/start?to=%2Fcourses%2F${ID}&next=register`);
    expect(startReturnHref(ID, "login")).toBe(`/api/return/start?to=%2Fcourses%2F${ID}&next=login`);
  });
});

describe("Buy course, signed out (/api/return/start)", () => {
  it("remembers the course and sends a new visitor to sign up as talent", async () => {
    const res = await start(req(startReturnHref(ID, "register")));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/register?as=talent");
    const c = res.cookies.get(RETURN_COOKIE)!;
    expect(c.value).toBe(`/courses/${ID}`);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("lax");
    expect(c.maxAge).toBe(RETURN_COOKIE_MAX_AGE);
    expect(c.path).toBe("/");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends someone with an account to log in, with the same cookie", async () => {
    const res = await start(req(startReturnHref(ID, "login")));
    expect(location(res)).toBe("/login");
    expect(res.cookies.get(RETURN_COOKIE)!.value).toBe(`/courses/${ID}`);
  });

  it("an invalid destination sets no cookie and the visitor still signs up", async () => {
    for (const to of ["https://evil.example", "/staff/users", "//evil.example", "/courses/short"]) {
      const res = await start(req(`/api/return/start?to=${encodeURIComponent(to)}&next=register`));
      expect(location(res)).toBe("/register?as=talent");
      expect(res.cookies.get(RETURN_COOKIE), to).toBeUndefined();
    }
    const missing = await start(req("/api/return/start"));
    expect(location(missing)).toBe("/register?as=talent");
    expect(missing.cookies.get(RETURN_COOKIE)).toBeUndefined();
  });

  it("only login and register are valid next steps; anything else registers", async () => {
    const res = await start(req(`/api/return/start?to=%2Fcourses%2F${ID}&next=https%3A%2F%2Fevil.example`));
    expect(location(res)).toBe("/register?as=talent");
  });
});

describe("after every gate has passed (/api/return/continue)", () => {
  it("goes to the remembered course once and forgets it", async () => {
    const res = await cont(req("/api/return/continue", `/courses/${ID}`));
    expect(location(res)).toBe(`/courses/${ID}`);
    const cleared = res.cookies.get(RETURN_COOKIE)!;
    expect(cleared.value).toBe("");
    expect(cleared.maxAge === 0 || (cleared.expires !== undefined && new Date(cleared.expires).getTime() <= Date.now())).toBe(true);
  });

  it("with no cookie, or a tampered one, only ever lands on the dashboard", async () => {
    for (const cookie of [undefined, "/staff/users", "https://evil.example", "//evil.example", "/courses/short"]) {
      const res = await cont(req("/api/return/continue", cookie));
      expect(location(res), String(cookie)).toBe("/dashboard");
    }
  });
});
