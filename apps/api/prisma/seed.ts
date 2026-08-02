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

  // Create demo users
  const password = await bcrypt.hash("demo1234", 12);

  const users = [
    { name: "Bablu Goud", username: "employee", role: "EMPLOYEE" },
    { name: "Karthik Menon", username: "production", role: "PRODUCTION" },
    { name: "Ravi Teja", username: "production2", role: "PRODUCTION" },
    { name: "Priya Sharma", username: "accountant", role: "ACCOUNTS" },
    { name: "Mahesh Goud", username: "admin", role: "ADMIN" },
    { name: "Suresh Kumar", username: "operator", role: "OPERATOR" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        name: u.name,
        username: u.username,
        password,
        role: u.role as any,
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
