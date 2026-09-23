/**
 * Boots a throwaway embedded PostgreSQL for the test run, applies migrations,
 * and hands the connection string to test files via `inject("databaseUrl")`.
 * Set TEST_DATABASE_URL to use an existing server instead (CI service container).
 */
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export default async function globalSetup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  let pg: EmbeddedPostgres | null = null;
  let dir: string | null = null;

  if (!url) {
    const port = await freePort();
    dir = mkdtempSync(path.join(tmpdir(), "hirewise-pg-"));
    pg = new EmbeddedPostgres({ databaseDir: dir, user: "test", password: "test", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("hirewise_test");
    url = `postgresql://test:test@127.0.0.1:${port}/hirewise_test`;
  }

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "pipe" });
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  project.provide("databaseUrl", url);

  return async () => {
    if (pg) await pg.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  };
}
