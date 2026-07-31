import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const newMediaList = [
  "Normal Flex Printing",
  "Normal Blackout Flex Printing",
  "Star Blackout Flex Printing",
  "Star Backlight Flex Printing",
  "UV Star Blackout Flex Printing",
  "UV Star Backlight Flex Printing",
  "Ecosolvent Vinyl",
  "Ecosolvent Mat Lamination",
  "Ecosolvent Mat Lamination on 3mm Sun Board",
  "Ecosolvent Mat Lamination on 5mm Sun Board",
  "Ecosolvent Glossy Lamination",
  "Ecosolvent Glossy Lamination on 3mm Sun Board",
  "Ecosolvent Glossy Lamination on 5mm Sun Board",
  "Solvent Vinyl",
  "Solvent Vinyl on 3mm Sun Board",
  "Solvent Vinyl on 5mm Sun Board",
  "Fabric Printing",
  "UV Fabric Printing",
  "UV Fabric Printing with Stitching",
  "Fabric Print with Frame",
  "Translite",
  "Glow Sign Board",
  "D/S Glow Sign Board",
  "Glow Sign Board with UV Print",
  "MS Pole",
  "Anglers",
  "Tube Lights",
  "Transportation",
  "Ecosolvent Grey Back Vinyl Mat Lamination",
  "Ecosolvent Grey Back Vinyl Mat Lamination on 3mm Sun Board",
  "Ecosolvent Grey Back Vinyl Mat Lamination on 5mm Sun Board",
  "Ecosolvent Grey Back Vinyl Glossy Lamination",
  "Ecosolvent Grey Back Vinyl Glossy Lamination on 3mm Sun Board",
  "Ecosolvent Grey Back Vinyl Glossy Lamination on 5mm Sun Board",
  "3M Vinyl Mat Lamination",
  "3M Vinyl Mat Lamination on 3mm Sun Board",
  "3M Vinyl Mat Lamination on 5mm Sun Board",
  "3M Vinyl Glossy Lamination",
  "3M Vinyl Glossy Lamination on 3mm Sun Board",
  "3M Vinyl Glossy Lamination on 5mm Sun Board",
  "ACP Cladding - Ceiling",
  "ACP Cladding - Top Packing",
  "ACP Cladding - Bottom Packing",
  "ACP Cladding - Side Packing",
  "ACP Cladding - Pillars",
  "Scaffolding",
  "Clear Vinyl",
  "Cut Vinyl",
  "Frosted Vinyl",
  "Invoice Purpose",
  "Ladder Charges",
  "Service Charges",
  "Installation Charges",
  "Board Issue",
  "Wiring",
  "Night Glow Vinyl",
  "400W Power Supply",
  "Slim Power Supply",
  "K-8000 Controller",
  "Visiting Cards",
  "Roll Up Standee - Normal Blackout Flex Printing",
  "Roll Up Standee - Star Blackout Flex Printing"
];

async function seed() {
  console.log(`Starting to seed ${newMediaList.length} new media items...`);
  
  let addedCount = 0;
  for (const name of newMediaList) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    
    // Check if it exists case-insensitively
    const existing = await prisma.media.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } }
    });
    
    if (!existing) {
      await prisma.media.create({ data: { name: trimmed } });
      addedCount++;
      console.log(`Added: ${trimmed}`);
    } else {
      console.log(`Already exists: ${trimmed} (found as: ${existing.name})`);
    }
  }
  
  console.log(`\nFinished! Added ${addedCount} new media items.`);
}

seed()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
