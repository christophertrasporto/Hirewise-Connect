import { z } from "zod";

/**
 * Environment validated once at boot (Section 12, security baseline).
 * Call getEnv() lazily so that pages which never touch the server layer do not
 * fail to build when optional variables are missing.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".storage"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  EMAIL_DRIVER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("Hirewise Connect <no-reply@hirewise.example>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),

  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),

  // Phase 5 integrations, each behind an adapter with a local fake.
  PAYMENT_PROVIDER: z.enum(["manual", "fake", "stripe"]).default("manual"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MEETING_PROVIDER: z.enum(["none", "fake", "zoom"]).default("none"),
  ZOOM_ACCOUNT_ID: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  SMS_DRIVER: z.enum(["console", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.STORAGE_DRIVER === "s3") {
    const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !parsed.data[k as keyof Env]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 requires: ${missing.join(", ")}`);
  }
  if (parsed.data.EMAIL_DRIVER === "smtp" && !parsed.data.SMTP_HOST) {
    throw new Error("EMAIL_DRIVER=smtp requires SMTP_HOST");
  }
  if (parsed.data.PAYMENT_PROVIDER === "stripe" && (!parsed.data.STRIPE_SECRET_KEY || !parsed.data.STRIPE_WEBHOOK_SECRET)) {
    throw new Error("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET");
  }
  if (parsed.data.MEETING_PROVIDER === "zoom" && (!parsed.data.ZOOM_ACCOUNT_ID || !parsed.data.ZOOM_CLIENT_ID || !parsed.data.ZOOM_CLIENT_SECRET)) {
    throw new Error("MEETING_PROVIDER=zoom requires ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET");
  }
  if (parsed.data.SMS_DRIVER === "twilio" && (!parsed.data.TWILIO_ACCOUNT_SID || !parsed.data.TWILIO_AUTH_TOKEN || !parsed.data.TWILIO_FROM)) {
    throw new Error("SMS_DRIVER=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.PAYMENT_PROVIDER === "fake") {
    throw new Error("PAYMENT_PROVIDER=fake is not allowed in production");
  }
  cached = parsed.data;
  return cached;
}

/** Test helper. */
export function resetEnvCache() {
  cached = null;
}
