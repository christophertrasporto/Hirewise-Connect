import { describe, expect, it } from "vitest";
import { coverAccent, coverKeyPrefix, difficultyLabel, COVER_MAX_BYTES, COVER_MIMES } from "@/lib/course-cover";

describe("course cover helpers", () => {
  it("picks a stable accent per category from the palette", () => {
    const palette = new Set(["#0ea47a", "#e8b44c", "#38bdf8", "#a78bfa", "#fb7185", "#2dd4bf"]);
    for (const c of ["Sales", "Customer Service", "Virtual Assistance", "Finance", "", "Ünïcode"]) {
      expect(palette.has(coverAccent(c))).toBe(true);
      expect(coverAccent(c)).toBe(coverAccent(c));
    }
    expect(new Set(["Sales", "Support", "Admin", "Finance", "Marketing", "Tools", "Industry"].map(coverAccent)).size).toBeGreaterThan(2);
  });

  it("scopes keys to the course and limits uploads to three image types up to 2 MB", () => {
    expect(coverKeyPrefix("abc")).toBe("courses/abc/cover/");
    expect(Object.keys(COVER_MIMES).sort()).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(COVER_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("formats difficulty for display", () => {
    expect(difficultyLabel("BEGINNER")).toBe("Beginner");
    expect(difficultyLabel(null)).toBeNull();
  });
});
