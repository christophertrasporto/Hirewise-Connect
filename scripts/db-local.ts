/**
 * Starts a real PostgreSQL server (embedded binaries) for local development when
 * Docker is not available. Equivalent to `docker compose up postgres`.
 *
 *   npm run db:local
 *
 * Data persists in .pgdata/. Connection string:
 *   postgresql://hirewise:hirewise@localhost:5433/hirewise_dev
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import { existsSync } from "node:fs";

const PORT = Number(process.env.PG_LOCAL_PORT ?? 5433);
const DATA_DIR = path.resolve(process.env.PG_LOCAL_DATA ?? ".pgdata");

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "hirewise",
    password: "hirewise",
    port: PORT,
    persistent: true,
    onLog: () => {},
    onError: (msg) => console.error(String(msg)),
  });

  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log(`Initialising cluster in ${DATA_DIR} ...`);
    await pg.initialise();
  }
  await pg.start();

  for (const name of ["hirewise_dev", "hirewise_test"]) {
    try {
      await pg.createDatabase(name);
      console.log(`Created database ${name}`);
    } catch {
      // already exists
    }
  }

  console.log(`\nPostgreSQL ready on port ${PORT}`);
  console.log(`DATABASE_URL=postgresql://hirewise:hirewise@localhost:${PORT}/hirewise_dev`);
  console.log("Press Ctrl+C to stop.\n");

  const stop = async () => {
    console.log("Stopping PostgreSQL ...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
