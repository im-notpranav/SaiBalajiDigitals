const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function fixChecksum() {
  const migrations = fs.readdirSync('prisma/migrations').filter(f => f.startsWith('2026'));
  
  for (const mig of migrations) {
    const file = fs.readFileSync(`prisma/migrations/${mig}/migration.sql`, 'utf8');
    const hash = crypto.createHash('sha256').update(file).digest('hex');
    
    await prisma.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2`, hash, mig);
    console.log(`Updated checksum for ${mig} to ${hash}`);
  }
}

fixChecksum()
  .then(() => prisma.$disconnect())
  .catch(console.error);
