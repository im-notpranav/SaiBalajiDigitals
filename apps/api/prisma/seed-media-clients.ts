/**
 * Loads the client and media lists into a database that already has users.
 *
 * prisma/seed.ts stops before this step when any user exists, so a production
 * database that was set up by hand never gets the lists. This script touches only
 * the Client and Media tables, never users, and is safe to run twice.
 *
 *   DATABASE_URL=<prod url> npm run db:seed:lists -w apps/api
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  const file = path.resolve(__dirname, "phase1_client_media_seed.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as { clients: string[]; media: string[] };

  const clients = await prisma.client.createMany({
    data: data.clients.map((name) => ({ name })),
    skipDuplicates: true,
  });
  const media = await prisma.media.createMany({
    data: data.media.map((name) => ({ name })),
    skipDuplicates: true,
  });

  console.log(`Clients added: ${clients.count} of ${data.clients.length}`);
  console.log(`Media added: ${media.count} of ${data.media.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
