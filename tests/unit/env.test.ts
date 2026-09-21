import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/server/env";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
});

describe("getEnv()", () => {
  it("fails fast with a readable message when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("requires S3 settings when STORAGE_DRIVER=s3", () => {
    process.env.DATABASE_URL = "postgresql://x";
    process.env.STORAGE_DRIVER = "s3";
    expect(() => getEnv()).toThrow(/S3_BUCKET/);
  });

  it("applies defaults", () => {
    process.env.DATABASE_URL = "postgresql://x";
    delete process.env.SIGNED_URL_TTL_SECONDS;
    const env = getEnv();
    expect(env.SIGNED_URL_TTL_SECONDS).toBe(600);
    expect(env.STORAGE_DRIVER).toBe("local");
  });
});
