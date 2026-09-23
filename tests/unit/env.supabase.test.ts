import { afterEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvCache } from "@/server/env";

const POOLER = "aws-0-ap-southeast-2.pooler.supabase.com";
const base = { NODE_ENV: "test", APP_URL: "http://localhost:3000" };

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (["DATABASE_URL", "DIRECT_URL"].includes(k)) delete process.env[k];
  Object.assign(process.env, base, vars);
  resetEnvCache();
  try {
    fn();
  } finally {
    process.env = saved;
    resetEnvCache();
  }
}

describe("Supabase connection validation (ADR 006)", () => {
  afterEach(() => resetEnvCache());

  it("accepts the transaction pooler with the flag plus a session-mode DIRECT_URL on the same host", () => {
    withEnv({ DATABASE_URL: `postgresql://u:p@${POOLER}:6543/postgres?pgbouncer=true&connection_limit=1`, DIRECT_URL: `postgresql://u:p@${POOLER}:5432/postgres` }, () => {
      expect(getEnv().DIRECT_URL).toContain(":5432/");
    });
  });

  it("rejects the transaction pooler without pgbouncer=true", () => {
    withEnv({ DATABASE_URL: `postgresql://u:p@${POOLER}:6543/postgres`, DIRECT_URL: `postgresql://u:p@${POOLER}:5432/postgres` }, () => {
      expect(() => getEnv()).toThrow(/pgbouncer=true/);
    });
  });

  it("rejects a missing DIRECT_URL and a DIRECT_URL on port 6543", () => {
    withEnv({ DATABASE_URL: `postgresql://u:p@${POOLER}:6543/postgres?pgbouncer=true` }, () => {
      expect(() => getEnv()).toThrow(/DIRECT_URL is required/);
    });
    withEnv({ DATABASE_URL: `postgresql://u:p@${POOLER}:6543/postgres?pgbouncer=true`, DIRECT_URL: `postgresql://u:p@${POOLER}:6543/postgres` }, () => {
      expect(() => getEnv()).toThrow(/port 6543/);
    });
  });

  it("leaves local and direct connections alone", () => {
    withEnv({ DATABASE_URL: "postgresql://hirewise:hirewise@localhost:5433/hirewise_dev" }, () => {
      expect(getEnv().DATABASE_URL).toContain("localhost");
    });
  });
});
