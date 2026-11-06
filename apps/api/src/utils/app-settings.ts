/**
 * Business settings the Admin can change without a deploy. Each setting has a default here,
 * used until someone saves a value, and a validator for what may be saved.
 */
import { prisma } from "./prisma";

export const SETTINGS = {
  /** A payment request's waiting condition turns red after this many working days. */
  payment_overdue_days: { default: 10, valid: (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 90 },
  /** Payment requests above this many rupees always go to the Admin first (decision D-07). */
  payment_admin_threshold: {
    default: 10_000,
    valid: (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99_999_999,
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

/** Settings change rarely and are read on every list, so they are kept for a minute. */
const CACHE_MS = 60_000;
const cache = new Map<SettingKey, { value: unknown; at: number }>();

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as SettingValue<K>;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = row && SETTINGS[key].valid(row.value) ? (row.value as SettingValue<K>) : SETTINGS[key].default;
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Saves a setting; returns false when the value is not allowed. */
export async function setSetting<K extends SettingKey>(key: K, value: unknown, userId: number): Promise<boolean> {
  if (!SETTINGS[key].valid(value)) return false;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: value as any, updated_by: userId },
    update: { value: value as any, updated_by: userId },
  });
  cache.set(key, { value, at: Date.now() });
  return true;
}
