import { describe, expect, it } from "vitest";
import { scanMessage } from "@/lib/message-filter";

describe("mediated-thread content filter (Section 8.8)", () => {
  it("holds messages that contain a phone number or email", () => {
    expect(scanMessage("Call me on +63 917 123 4567 tonight").contactInfo).toBe(true);
    expect(scanMessage("my number is 555-010-0199").contactInfo).toBe(true);
    expect(scanMessage("reach me at jordan@acme-solar.example").contactInfo).toBe(true);
  });

  it("holds messaging app links and handle hints", () => {
    expect(scanMessage("add me on wa.me/639171234567").contactInfo).toBe(true);
    expect(scanMessage("here is my skype id, ping me").contactInfo).toBe(true);
    expect(scanMessage("linkedin.com/in/jordan-lee").contactInfo).toBe(true);
  });

  it("flags rate and direct-hire language without treating it as contact info", () => {
    const s = scanMessage("What is your hourly rate? Could we work together directly?");
    expect(s.rateTalk).toBe(true);
    expect(s.contactInfo).toBe(false);
    expect(s.reasons).toContain("rate or direct-hire language");
  });

  it("leaves ordinary scheduling text alone, including years and short numbers", () => {
    const s = scanMessage("Thursday 9:00 AM PST works. We started this campaign in 2024 with 3 agents.");
    expect(s.contactInfo).toBe(false);
    expect(s.rateTalk).toBe(false);
    expect(s.reasons).toEqual([]);
  });
});
