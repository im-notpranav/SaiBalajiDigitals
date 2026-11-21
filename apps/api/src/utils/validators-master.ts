import { z } from "zod";
import { CODE_PATTERN, cleanCode, cleanName } from "./master-names";

/** Request bodies for the Master Library (see controllers/master-library.controller.ts). */

const name = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? cleanName(v) : v), z.string().min(1, "Type a name.").max(max, `Up to ${max} letters.`));

/** Blank means no code. Codes are kept in capitals. */
const code = z.preprocess(
  (v) => (typeof v === "string" ? cleanCode(v) || null : v),
  z.string().regex(CODE_PATTERN, "Code can only have letters, numbers, - and _ (up to 30).").nullable(),
);

const district = z.preprocess(
  (v) => (typeof v === "string" ? cleanName(v) || null : v),
  z.string().max(100, "Up to 100 letters.").nullable(),
);

/** Optional free text: blank means none. */
const opt = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") || null : v), z.string().max(max, `Up to ${max} letters.`).nullable()).optional();

/** A client's contact details, from the client sheet. */
const clientDetails = {
  short_name: opt(100),
  contact_person: opt(100),
  contact_number: opt(30),
  email: opt(200),
  csm_name: opt(100),
};

export const masterKindSchema = z.enum(["CLIENT", "MEDIA", "LOCATION"]);
export const localitySchema = z.enum(["LOCAL", "NON_LOCAL"]);

export const clientEntrySchema = z.object({
  name: name(200),
  code: code.optional(),
  is_active: z.boolean().optional(),
  ...clientDetails,
  block_orders: z.boolean().optional(),
  pending_block_days: z.number().int().min(0).max(3650).optional(),
  payment_block_days: z.number().int().min(0).max(3650).optional(),
});

export const mediaEntrySchema = z.object({
  name: name(200),
  is_active: z.boolean().optional(),
  default_machine_id: z.number().int().positive().nullable().optional(),
});

export const locationEntrySchema = z.object({
  name: name(100),
  locality: localitySchema,
  district: district.optional(),
  state: opt(60),
  is_active: z.boolean().optional(),
});

export const mergeSchema = z.object({
  kind: masterKindSchema,
  keep_id: z.number().int().positive(),
  merge_ids: z.array(z.number().int().positive()).min(1).max(50),
});

export const notSameSchema = z.object({
  kind: masterKindSchema,
  ids: z.array(z.number().int().positive()).min(2).max(50),
});

export const nameRequestSchema = z.object({
  kind: masterKindSchema,
  name: name(200),
  note: z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().max(300).nullable()).optional(),
  /** Everything else the CSM fills in for the new name (see requestDetailsSchema). */
  details: z.record(z.string(), z.unknown()).optional(),
});

/** What a CSM fills in beside the name: the whole client, line item or location row. */
export const requestDetailsSchema = z.object({
  ...clientDetails,
  machine_id: z.number().int().positive().nullable().optional(),
  locality: localitySchema.optional(),
  district: district.optional(),
  state: opt(60),
});

export const approveRequestSchema = z.object({
  /** The spelling to add, when the admin corrects the one asked for. */
  name: name(200).optional(),
  code: code.optional(),
  locality: localitySchema.optional(),
  district: district.optional(),
  state: opt(60),
  ...clientDetails,
  machine_id: z.number().int().positive().nullable().optional(),
});

export const rejectRequestSchema = z.object({
  reason: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().min(1, "Say why.").max(300)),
});
