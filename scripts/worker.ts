import "dotenv/config";
import { prisma } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { runWorkerLoop } from "@/server/jobs/worker";

const env = getEnv();
const ac = new AbortController();
process.on("SIGINT", () => ac.abort());
process.on("SIGTERM", () => ac.abort());

runWorkerLoop(prisma, env.WORKER_POLL_MS, ac.signal)
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
