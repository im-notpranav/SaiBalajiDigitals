import { config } from "dotenv";
import path from "node:path";

/**
 * Where the API tests run: TEST_DATABASE_URL if set, else the dev DATABASE_URL with
 * `_test` added to the database name. Anything not ending in `_test` is refused, because
 * the global setup drops and recreates it.
 */
export function testDatabaseUrl(): string {
  config({ path: path.resolve(__dirname, "../../.env") });
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit || process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) in apps/api/.env to run the API tests.");
  const url = new URL(base);
  if (!explicit) url.pathname = `${url.pathname.replace(/\/$/, "")}_test`;
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to use "${name}" for tests: the test database name must end in _test.`);
  }
  return url.toString();
}
