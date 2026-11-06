import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-db";

/**
 * Drop and recreate the test database, build its tables from schema.prisma, then add the
 * constraints and triggers the schema cannot express (db-extras.sql). The migration
 * history is not replayable onto an empty database, so `migrate deploy` is not used.
 */
export default async function setup() {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to recreate "${name}".`);

  const admin = new URL(url.toString());
  admin.pathname = "/postgres";
  admin.search = "";
  const server = new Client({ connectionString: admin.toString() });
  await server.connect();
  try {
    await server.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.query(`CREATE DATABASE "${name}"`);
  } finally {
    await server.end();
  }

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.resolve(__dirname, "../.."),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });

  const plain = new URL(url.toString());
  plain.search = "";
  const db = new Client({ connectionString: plain.toString() });
  await db.connect();
  try {
    await db.query(readFileSync(path.resolve(__dirname, "db-extras.sql"), "utf8"));
  } finally {
    await db.end();
  }
}
