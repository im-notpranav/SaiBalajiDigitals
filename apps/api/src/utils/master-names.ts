/**
 * Name rules for the Master Library (clients, media, locations).
 *
 * Names are stored as plain text on orders, so a second spelling of the same client ("Big C",
 * "BigC", "BIG-C") splits its orders across reports. These helpers decide when two names are
 * the same, and find the near-identical ones the admin should merge. Pure functions, no database.
 */

export type MasterKind = "CLIENT" | "MEDIA" | "LOCATION";

export const MASTER_KINDS: readonly MasterKind[] = ["CLIENT", "MEDIA", "LOCATION"];

export const KIND_LABELS: Record<MasterKind, string> = {
  CLIENT: "client",
  MEDIA: "media",
  LOCATION: "location",
};

/** Trims and collapses runs of spaces, so "Big  C " is saved as "Big C". */
export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the uniqueness rule compares: the cleaned name, ignoring case. */
export function lowerKey(raw: unknown): string {
  return cleanName(raw).toLowerCase();
}

/**
 * The name with case, spaces and punctuation removed, so "Big C", "BigC" and "BIG-C" all give
 * "bigc". "&" counts as "and". Letters of any script are kept; a name made only of punctuation
 * falls back to its lower-case form so it never collides with every other such name.
 */
export function nameKey(raw: unknown): string {
  const lower = lowerKey(raw);
  const key = lower
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]/gu, "");
  return key || lower;
}

/** The digits in a key, in order. Names that differ in their numbers ("Phase 1", "Phase 2") are different places. */
const digitsOf = (key: string) => key.replace(/\D/g, "");

/**
 * Typing slips between two strings: a letter added, dropped, changed, or two side by side
 * swapped ("Relaince") each count as one. Gives up once the answer is certainly above `max`
 * (then it returns max + 1), which keeps the duplicate scan quick on a few thousand names.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    // A row's smallest value never goes down further on, so past `max` the answer is settled.
    if (rowMin > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return Math.min(prev[b.length]!, max + 1);
}

/**
 * How many typing slips two keys may differ by and still look like one name. Short names get
 * none ("Spar" and "Star" are different shops); from 6 letters one slip, from 12 two.
 */
export function allowedSlips(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  if (len >= 12) return 2;
  if (len >= 6) return 1;
  return 0;
}

const wordsOf = (name: string) =>
  lowerKey(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Names that differ only in short words are branches or codes, not typing slips:
 * "Reliance Retail Limited - AP" and "- TS", "Greenlam Industries Limited" and "... - AP",
 * "Store A" and "Store B".
 */
export function differsOnlyInShortWords(a: string, b: string): boolean {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  const diff = [...wa.filter((w) => !wb.includes(w)), ...wb.filter((w) => !wa.includes(w))];
  return diff.length > 0 && diff.every((w) => w.length <= 3);
}

/** Two different keys a slip or two apart, with the same numbers and not just a short word apart. */
function slipApart(nameA: string, nameB: string, ka: string, kb: string): boolean {
  if (digitsOf(ka) !== digitsOf(kb)) return false;
  const max = allowedSlips(ka, kb);
  if (max === 0 || Math.abs(ka.length - kb.length) > max) return false;
  return editDistance(ka, kb, max) <= max && !differsOnlyInShortWords(nameA, nameB);
}

/** True when two names are near-identical: the same key, or a slip or two apart (see slipApart). */
export function looksSame(a: string, b: string): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  return ka === kb || slipApart(a, b, ka, kb);
}

/** Identifies a group by its members' names, so a group marked "not the same" stays hidden until its members change. */
export function groupSignature(names: string[]): string {
  return names.map(lowerKey).sort().join("|");
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name);

/**
 * Groups near-identical names. Every group has two or more members, sorted by name; groups are
 * sorted by their first name. `notSame` holds signatures (see groupSignature) the admin has
 * marked as different names; those groups are left out.
 */
export function findDuplicateGroups<T extends { name: string }>(items: T[], notSame: Set<string> = new Set()): T[][] {
  // Names with the same key are one group from the start; only distinct keys are compared.
  const byKey = new Map<string, T[]>();
  for (const it of items) {
    const k = nameKey(it.name);
    const list = byKey.get(k);
    if (list) list.push(it);
    else byKey.set(k, [it]);
  }
  const keys = [...byKey.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));

  const parent = keys.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };

  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!;
    if (a.length < 6) continue; // too short for any slip
    const nameA = byKey.get(a)![0]!.name;
    // Sorted by length, so the scan stops once the keys are more than two letters longer.
    for (let j = i + 1; j < keys.length && keys[j]!.length - a.length <= 2; j++) {
      const b = keys[j]!;
      if (slipApart(nameA, byKey.get(b)![0]!.name, a, b)) parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, T[]>();
  keys.forEach((k, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(...byKey.get(k)!);
    groups.set(root, list);
  });

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort(byName))
    .filter((g) => !notSame.has(groupSignature(g.map((m) => m.name))))
    .sort((a, b) => byName(a[0]!, b[0]!));
}

// ---------------------------------------------------------------------------
// Cell values used by the import sheet and the forms
// ---------------------------------------------------------------------------

/** Client codes: letters, numbers, - and _. Stored in capitals so "bigc" and "BIGC" are one code. */
export const CODE_PATTERN = /^[A-Z0-9_-]{1,30}$/;

export function cleanCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

/** "Hyderabad" / "Non-local" as typed in a sheet. Undefined for a blank cell, null when it cannot be read. */
export function parseLocality(raw: unknown): "LOCAL" | "NON_LOCAL" | null | undefined {
  const t = String(raw ?? "").trim().toLowerCase().replace(/[\s_.-]+/g, "");
  if (!t) return undefined;
  if (["hyderabad", "hyd", "local", "hydlocal", "city", "hyderabadcity"].includes(t)) return "LOCAL";
  if (["nonlocal", "nonhyderabad", "outside", "outsidehyderabad", "outstation", "nl"].includes(t)) return "NON_LOCAL";
  return null;
}

/** "Yes" / "No" (or Active / Archived) as typed in a sheet. Undefined for a blank cell, null when it cannot be read. */
export function parseActive(raw: unknown): boolean | null | undefined {
  const t = String(raw ?? "").trim().toLowerCase();
  if (!t) return undefined;
  if (["yes", "y", "true", "1", "active"].includes(t)) return true;
  if (["no", "n", "false", "0", "archived", "inactive"].includes(t)) return false;
  return null;
}

export const LOCALITY_SHEET_LABELS = { LOCAL: "Hyderabad", NON_LOCAL: "Non-local" } as const;
