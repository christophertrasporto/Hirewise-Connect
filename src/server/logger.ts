import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({
  level,
  base: { service: "hirewise-connect" },
  redact: {
    paths: ["*.password", "*.passwordHash", "*.phone", "*.personalEmail", "*.addressLine", "*.authorization", "req.headers.cookie"],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
