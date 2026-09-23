import "dotenv/config";
import { createPrismaClient } from "@/server/db/client";
import { BootstrapError, bootstrapSuperAdmin, generateBootstrapPassword } from "./lib/bootstrap-admin";

/**
 * Create the first Super Admin in an environment that has the foundation seed and no accounts.
 *
 *   npm run bootstrap:admin -- --email you@yourdomain.com
 *   npm run bootstrap:admin -- --email you@yourdomain.com --production      # uses PROD_DIRECT_URL from .env
 *   npm run bootstrap:admin -- --email you@yourdomain.com --reset-password  # replace an existing password
 *
 * The password comes from BOOTSTRAP_ADMIN_PASSWORD when set, otherwise one is generated and printed
 * exactly once. Nothing is written to disk. Admin roles are asked to enrol an authenticator app on first sign-in.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

function describe(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

async function main() {
  const email = arg("--email");
  if (!email) throw new BootstrapError("Usage: npm run bootstrap:admin -- --email <address> [--production] [--reset-password]");

  const url = flag("--production") ? process.env.PROD_DIRECT_URL || process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new BootstrapError(flag("--production") ? "PROD_DIRECT_URL is not set in .env" : "DATABASE_URL is not set");

  const generated = !process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? generateBootstrapPassword();

  const db = createPrismaClient(url);
  try {
    const result = await bootstrapSuperAdmin(db, { email, password, resetPassword: flag("--reset-password") });
    console.log(`Super Admin ${result.created ? "created" : result.passwordReset ? "password reset" : "promoted"} on ${describe(url)}`);
    console.log(`  Email:    ${result.email}`);
    if (generated) {
      console.log(`  Password: ${password}`);
      console.log("  (shown once; it is not stored anywhere else, so save it in your password manager now)");
    } else {
      console.log("  Password: as given in BOOTSTRAP_ADMIN_PASSWORD");
    }
    console.log(`Sign in at ${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/login and enrol an authenticator app when prompted.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof BootstrapError ? err.message : err);
  process.exit(1);
});
