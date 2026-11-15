import type { MasterEntry, MasterKind } from "@/api/masterLibrary";

/**
 * The same name rules as the API (apps/api/src/utils/master-names.ts), used on screen to warn
 * about a lookalike while the admin types. The server still decides.
 */

export function cleanName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function lowerKey(raw: string): string {
  return cleanName(raw).toLowerCase();
}

/** "Big C", "BigC" and "BIG-C" all give "bigc". */
export function nameKey(raw: string): string {
  const lower = lowerKey(raw);
  const key = lower
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return key || lower;
}

/** An entry other than `exceptId` that the name would clash with, if any. */
export function clashOf(entries: MasterEntry[], name: string, exceptId?: number): MasterEntry | undefined {
  const n = cleanName(name);
  if (!n) return undefined;
  const others = entries.filter((e) => e.id !== exceptId);
  return (
    others.find((e) => lowerKey(e.name) === lowerKey(n)) ?? others.find((e) => nameKey(e.name) === nameKey(n))
  );
}

/** Alphabetical, ignoring case, with numbers in number order ("Store 2" before "Store 10"). */
export const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** "12 orders", "340 items", "8 stores · 3 jobs", or "Not used". */
export function usageText(kind: MasterKind, e: Pick<MasterEntry, "uses" | "usage">): string {
  if (!e.usage) return "Not used";
  const u = e.uses;
  if (kind === "CLIENT") return plural(u.orders ?? 0, "order");
  if (kind === "MEDIA") return plural(u.items ?? 0, "item");
  return [u.stores ? plural(u.stores, "store") : null, u.jobs ? plural(u.jobs, "job") : null].filter(Boolean).join(" · ");
}

/** What the usage counts are, for the "records move" line of a merge. */
export const RECORD_WORD: Record<MasterKind, string> = {
  CLIENT: "orders",
  MEDIA: "order items",
  LOCATION: "stores and jobs",
};
