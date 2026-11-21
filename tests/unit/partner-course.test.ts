import { describe, expect, it } from "vitest";
import { PARTNER_BUTTON_LABEL, PARTNER_DISCLOSURE, cleanPartnerText, parsePartnerUrl, partnerGoPath, partnerPriceText, partnerPublishProblem } from "@/lib/partner-course";
import { courseCta } from "@/lib/course-cta";

describe("partner link validation", () => {
  it("accepts a full https address and keeps its query (the affiliate code)", () => {
    const r = parsePartnerUrl("  https://www.udemy.com/course/closing/?couponCode=HW10&aff=77  ", "https://hirewise.example");
    expect(r).toEqual({ ok: true, url: "https://www.udemy.com/course/closing/?couponCode=HW10&aff=77" });
  });

  it("refuses everything else: other schemes, credentials, private hosts, IP addresses, this site, and nonsense", () => {
    const bad = ["http://www.udemy.com/x", "javascript:alert(1)", "data:text/html,hi", "ftp://x.com/a", "https://u:p@udemy.com/x", "https://localhost/x", "https://app.localhost/x", "https://intranet/x", "https://10.0.0.1/x", "https://[::1]/x", "https://printer.local/x", "https://hirewise.example/academy", "udemy.com/course", "", "   ", null, undefined, 5, "https://" + "a".repeat(2100) + ".com"];
    for (const b of bad) expect(parsePartnerUrl(b, "https://hirewise.example"), String(b).slice(0, 40)).toMatchObject({ ok: false });
  });
});

describe("partner text and publish rule", () => {
  it("trims and limits the typed texts, and empty means none", () => {
    expect(cleanPartnerText("  from   $19 ", 40)).toBe("from $19");
    expect(cleanPartnerText("x".repeat(100), 10)).toHaveLength(10);
    expect(cleanPartnerText("   ", 40)).toBeNull();
    expect(cleanPartnerText(null, 40)).toBeNull();
  });

  it("shows the typed price, else who sells it", () => {
    expect(partnerPriceText("Udemy", "from $19")).toBe("from $19");
    expect(partnerPriceText("Udemy", null)).toBe("On Udemy");
    expect(partnerPriceText(null, null)).toBe("Partner course");
    expect(partnerGoPath("closing-mastery")).toBe("/go/closing-mastery");
  });

  it("needs the link, the partner's name and a cover", () => {
    expect(partnerPublishProblem({})).toMatch(/partner link/);
    expect(partnerPublishProblem({ externalUrl: "https://x.com/a" })).toMatch(/partner's name/);
    expect(partnerPublishProblem({ externalUrl: "https://x.com/a", externalProvider: "Udemy" })).toMatch(/cover/);
    expect(partnerPublishProblem({ externalUrl: "https://x.com/a", externalProvider: "Udemy", thumbnailKey: "k" })).toBeNull();
    expect(partnerPublishProblem({ externalUrl: "https://x.com/a", externalProvider: "Udemy", hasCover: true })).toBeNull();
  });
});

describe("the button on a partner course", () => {
  it("is the same for every visitor: Take this course, to the go path, with the disclosure", () => {
    const course = { id: "course_12345678", priceCents: 0, partner: { goPath: "/go/closing" } };
    for (const state of ["SIGNED_OUT", "CAN_BUY", "PENDING", "OWNER", "ENDED", "NOT_TALENT"] as const) {
      expect(courseCta(state, course), state).toEqual({ label: PARTNER_BUTTON_LABEL, href: "/go/closing", note: PARTNER_DISCLOSURE, logIn: null, external: true });
    }
    expect(courseCta("CAN_BUY", { id: "course_12345678", priceCents: 1000 }).external).toBe(false);
  });
});
