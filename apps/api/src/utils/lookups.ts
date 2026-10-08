/**
 * Upsert a client/media name into its lookup table (case-insensitive), so names
 * typed on an order — or arriving via bulk import — populate the autocomplete lists.
 * Accepts a prisma client or a transaction client. Never throws.
 */
export async function ensureLookupValue(db: any, model: "client" | "media", name: string) {
  try {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    const existing = await db[model].findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
    if (!existing) await db[model].create({ data: { name: trimmed } });
  } catch (e) {
    console.error(`Lookup upsert failed for ${model}:`, e);
  }
}
