import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Initialize sequence
  await prisma.orderSequence.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      year_code: "25",
      last_number: 0,
    },
  });

  // Create demo users — ONLY on a fresh database.
  //
  // These upserts key on `username`. If an account is later renamed in the admin
  // portal, the upsert no longer matches it and would create a duplicate account
  // with a new id (this previously produced two "Bablu Goud" and two "Mahesh Goud"
  // accounts). Seeding is therefore skipped whenever any user already exists.
  // Set SEED_FORCE_USERS=true only against a database you intend to re-seed.
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && process.env.SEED_FORCE_USERS !== "true") {
    console.log(`Skipping user seed — ${existingUsers} user(s) already exist (set SEED_FORCE_USERS=true to override).`);
    console.log("Database seeded successfully (sequence only)");
    return;
  }

  const password = await bcrypt.hash("demo1234", 12);

  const users = [
    { name: "Bablu Goud", username: "employee", role: "CSM" },
    { name: "Karthik Menon", username: "production", role: "PRODUCTION" },
    { name: "Ravi Teja", username: "production2", role: "PRODUCTION" },
    { name: "Priya Sharma", username: "accountant", role: "ACCOUNTS" },
    { name: "Mahesh Goud", username: "maheshgoud", role: "ADMIN", is_super_admin: true },
    { name: "Suresh Kumar", username: "operator", role: "PRODUCTION_MANAGER" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { is_super_admin: u.is_super_admin ?? false },
      create: {
        name: u.name,
        username: u.username,
        password,
        role: u.role as any,
        is_super_admin: u.is_super_admin ?? false,
      },
    });
  }

  console.log("Database seeded successfully with users and sequences");

  // Seeding clients and media from phase1_client_media_seed.json
  const fs = await import('fs');
  const path = await import('path');
  const seedDataPath = path.resolve(process.cwd(), 'prisma/phase1_client_media_seed.json');
  const seedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf8'));
  console.log(`Seeding ${seedData.clients.length} clients and ${seedData.media.length} media items from JSON`);

  for (const name of seedData.clients) {
    await prisma.client.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of seedData.media) {
    await prisma.media.upsert({ where: { name }, update: {}, create: { name } });
  }

  // Upsert distinct values from Order and OrderItem tables case-insensitively
  const existingClients = await prisma.order.findMany({ select: { client_name: true }, distinct: ["client_name"] });
  for (const { client_name } of existingClients) {
    const trimmed = client_name.trim();
    if (!trimmed) continue;
    const found = await prisma.client.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
    if (!found) {
      await prisma.client.create({ data: { name: trimmed } }).catch(e => {
        if (e.code !== 'P2002') console.error(`Error creating client ${trimmed}`, e);
      });
    }
  }

  const existingMedia = await prisma.orderItem.findMany({ select: { media: true }, distinct: ["media"] });
  for (const { media } of existingMedia) {
    const trimmed = media.trim();
    if (!trimmed) continue;
    const found = await prisma.media.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
    if (!found) {
      await prisma.media.create({ data: { name: trimmed } }).catch(e => {
        if (e.code !== 'P2002') console.error(`Error creating media ${trimmed}`, e);
      });
    }
  }

  console.log("Database seeded successfully with clients and media");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
