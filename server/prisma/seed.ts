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
    { name: "Ananya Rao", username: "employee", role: "EMPLOYEE" },
    { name: "Karthik Menon", username: "production", role: "PRODUCTION" },
    { name: "Priya Sharma", username: "accountant", role: "ACCOUNTS" },
    { name: "Rajesh Balaji", username: "admin", role: "ADMIN" },
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

  console.log("Database seeded successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
