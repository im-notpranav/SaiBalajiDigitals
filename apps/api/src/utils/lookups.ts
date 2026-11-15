/**
 * Master Library names (2026-11-15). Only the admin adds client, media and location names;
 * everyone else picks from the lists. Orders keep the names as text, so every save checks
 * them here: a name must match an active master, case and outer spaces aside, and is saved
 * in the master's own spelling. A name an order already carries may stay on it even after
 * the admin archives it, so the callers leave unchanged names out of the check.
 *
 * Nothing here imports the database client: callers pass theirs (or a transaction), which
 * keeps the rules testable on their own.
 */

export type MasterKind = "CLIENT" | "MEDIA" | "LOCATION";

export interface MasterName {
  kind: MasterKind;
  name: string;
}

/** Lower-cased name -> the master's spelling, one map per kind. */
export type MasterLookup = Record<MasterKind, Map<string, string>>;

/** Spells a name as its master does; a name with no master comes back trimmed. */
export type Speller = (kind: MasterKind, name: string) => string;

const LABELS: Record<MasterKind, string> = { CLIENT: "Client", MEDIA: "Media", LOCATION: "Location" };
/** The order names are listed in: the sheet's own column order. */
const KIND_ORDER: MasterKind[] = ["CLIENT", "LOCATION", "MEDIA"];

/** How names are compared. */
export const nameKey = (name: string) => (name ?? "").trim().toLowerCase();

export const emptyLookup = (): MasterLookup => ({ CLIENT: new Map(), MEDIA: new Map(), LOCATION: new Map() });

/** A lookup from plain lists, for tests and for callers that already hold the names. */
export function lookupOf(names: Partial<Record<MasterKind, string[]>>): MasterLookup {
  const lookup = emptyLookup();
  for (const kind of KIND_ORDER) for (const n of names[kind] ?? []) addName(lookup, kind, n);
  return lookup;
}

function addName(lookup: MasterLookup, kind: MasterKind, name: string) {
  const key = nameKey(name);
  if (key && !lookup[kind].has(key)) lookup[kind].set(key, name.trim());
}

export const spellerOf = (lookup: MasterLookup): Speller => (kind, name) => lookup[kind].get(nameKey(name)) ?? name.trim();

/** The names the lookup does not hold, each once, in the order first met. Blank names are not checked. */
export function missingFrom(lookup: MasterLookup, names: MasterName[]): MasterName[] {
  const seen = new Set<string>();
  const missing: MasterName[] = [];
  for (const n of names) {
    const key = nameKey(n.name);
    if (!key || lookup[n.kind].has(key) || seen.has(`${n.kind}\u0000${key}`)) continue;
    seen.add(`${n.kind}\u0000${key}`);
    missing.push({ kind: n.kind, name: n.name.trim() });
  }
  return missing;
}

/** "Client 'Eric Traders' is not in Master Library. Ask the admin to add it." */
export function missingNamesMessage(missing: MasterName[]): string {
  if (missing.length === 1) {
    const [m] = missing;
    return `${LABELS[m!.kind]} '${m!.name}' is not in Master Library. Ask the admin to add it.`;
  }
  const list = missing.map((m) => `${LABELS[m.kind]} '${m.name}'`).join(", ");
  return `These are not in Master Library: ${list}. Ask the admin to add them.`;
}

/** The 400 body for a save refused over missing names. `missing` lets the browser offer to request each one. */
export const missingNamesBody = (missing: MasterName[]) => ({ message: missingNamesMessage(missing), missing });

/** A sheet row left out of an upload because it names something the admin has not added. */
export interface RejectedRow {
  row: number;
  missing: MasterName[];
}

export interface MissingNameGroup extends MasterName {
  /** The sheet rows that name it, in sheet order. */
  rows: number[];
}

/** One entry per missing name with the rows that need it: what the CSM takes to the admin. */
export function groupMissingNames(rejected: RejectedRow[]): MissingNameGroup[] {
  const groups = new Map<string, MissingNameGroup>();
  for (const r of rejected) {
    for (const m of r.missing) {
      const key = `${m.kind}\u0000${nameKey(m.name)}`;
      const group = groups.get(key) ?? { kind: m.kind, name: m.name, rows: [] };
      if (!group.rows.includes(r.row)) group.rows.push(r.row);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => a - b) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** The names a new order carries: its client, each store's location and each item's media. */
export interface OrderNames {
  client_name: string;
  stores: { location: string; items: { media: string }[] }[];
}

export const namesOfOrder = (o: OrderNames): MasterName[] => [
  { kind: "CLIENT", name: o.client_name },
  ...o.stores.flatMap((s) => [
    { kind: "LOCATION" as const, name: s.location },
    ...s.items.map((i) => ({ kind: "MEDIA" as const, name: i.media })),
  ]),
];

/** Rewrites an order's names in the masters' spelling, in place, and hands it back. */
export function spellOrder<T extends OrderNames>(o: T, spell: Speller): T {
  o.client_name = spell("CLIENT", o.client_name);
  for (const s of o.stores) {
    s.location = spell("LOCATION", s.location);
    for (const i of s.items) i.media = spell("MEDIA", i.media);
  }
  return o;
}

const tableOf = (db: any, kind: MasterKind) => (kind === "CLIENT" ? db.client : kind === "MEDIA" ? db.media : db.area);

/**
 * The active masters matching these names. The database match ignores case; the lookup is
 * keyed exactly by nameKey, so anything the database matched loosely is simply never used.
 */
export async function loadMasterLookup(db: any, names: MasterName[]): Promise<MasterLookup> {
  const lookup = emptyLookup();
  for (const kind of KIND_ORDER) {
    const wanted = [...new Set(names.filter((n) => n.kind === kind).map((n) => n.name.trim()).filter(Boolean))];
    if (wanted.length === 0) continue;
    const rows: { name: string }[] = await tableOf(db, kind).findMany({
      where: { is_active: true, OR: wanted.map((name) => ({ name: { equals: name, mode: "insensitive" } })) },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    rows.forEach((r) => addName(lookup, kind, r.name));
  }
  return lookup;
}

/** Every active master name, for reading a whole sheet at once. */
export async function loadAllMasterNames(db: any): Promise<MasterLookup> {
  const lookup = emptyLookup();
  for (const kind of KIND_ORDER) {
    const rows: { name: string }[] = await tableOf(db, kind).findMany({
      where: { is_active: true },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    rows.forEach((r) => addName(lookup, kind, r.name));
  }
  return lookup;
}

/** Checks names against the active masters: what is missing, and how to spell the rest. */
export async function checkMasterNames(db: any, names: MasterName[]): Promise<{ missing: MasterName[]; spell: Speller }> {
  const lookup = await loadMasterLookup(db, names);
  return { missing: missingFrom(lookup, names), spell: spellerOf(lookup) };
}
