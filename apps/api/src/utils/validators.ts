import { z } from "zod";

export const remarkEnum = z.enum([
  "Reprint",
  "Sample",
  "UnderWarranty",
  "Revised",
  "ExtraAmount",
  "LessAmount",
  "FreeOfCost",
  "Other",
]);

const itemLossEnum = z.enum(["Reprint", "Sample", "UnderWarranty", "FreeOfCost", "Other"]);

const baseOrderItemSchema = z.object({
  media: z.string().min(1).max(200),
  width_inches: z.coerce.number().positive(),
  height_inches: z.coerce.number().positive(),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().positive(),
  remarks: itemLossEnum.optional().nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
});

const itemRemarkRefine = (data: { remarks?: string | null; remarks_other_text?: string | null }) =>
  data.remarks !== "Other" || (data.remarks_other_text && data.remarks_other_text.trim().length > 0);
const itemRemarkRefineConfig = { message: "Text is required when Other is selected.", path: ["remarks_other_text"] };

export const orderItemSchema = baseOrderItemSchema.refine(itemRemarkRefine, itemRemarkRefineConfig);

export const updateOrderItemSchema = baseOrderItemSchema.extend({
  id: z.number().int().positive().optional(),
  /** Which store to append this item to. Defaults to the order's first store. */
  store_id: z.number().int().positive().optional(),
}).refine(itemRemarkRefine, itemRemarkRefineConfig);

const REMARKS_REQUIRING_TEXT = new Set(["Other", "Revised", "ExtraAmount", "LessAmount"]);
const remarksTextRefine = (data: { remarks?: string | null; remarks_other_text?: string | null }) =>
  !data.remarks || !REMARKS_REQUIRING_TEXT.has(data.remarks) ||
  !!(data.remarks_other_text && data.remarks_other_text.trim().length > 0);

/** One store within an order: its own address, its own PO, its own line items. */
export const createOrderStoreSchema = z.object({
  store_name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  po_number: z.string().max(50).optional().nullable(),
  items: z.array(orderItemSchema).min(1),
});

/**
 * A client cannot hand over the same store twice under one order number. A store is its
 * name AND its location: a chain repeats a name across places, so "MG Road, Bengaluru"
 * and "MG Road, Pune" are two stores rather than one entered twice.
 */
const uniqueStores = (data: { stores: { store_name: string; location: string }[] }) => {
  const seen = new Set<string>();
  for (const s of data.stores) {
    const key = `${s.store_name.trim().toLowerCase()}\u0000${s.location.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};
const uniqueStoresConfig = { message: "The same store at the same location appears more than once in this order.", path: ["stores"] };

export const createOrderSchema = z.object({
  client_name: z.string().min(1).max(100),
  date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Date cannot be in the future"),
  /** Job-level PO covering the whole order. Per-store POs live on each store. */
  po_number: z.string().max(50).optional().nullable(),
  remarks: remarkEnum.optional().nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
  stores: z.array(createOrderStoreSchema).min(1).max(50),
})
  .refine(remarksTextRefine, { message: "A reason is required for this remark type.", path: ["remarks_other_text"] })
  .refine(uniqueStores, uniqueStoresConfig);

/**
 * Line items only. Header fields (client, store, location, PO) have their own endpoints;
 * they are still parsed here so that sending one can be rejected with a message naming
 * the right endpoint, rather than silently ignored.
 */
export const updateOrderSchema = z.object({
  client_name: z.string().min(1).max(100).optional(),
  store_name: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(100).optional(),
  date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Date cannot be in the future").optional(),
  po_number: z.string().max(50).optional().nullable(),
  remarks: remarkEnum.optional().nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
  items: z.array(updateOrderItemSchema).min(1),
}).refine(remarksTextRefine, { message: "A reason is required for this remark type.", path: ["remarks_other_text"] });

/**
 * Order header fields. Every field is optional; `undefined` leaves it alone and an
 * explicit `null` on po_number clears it — which is how a wrongly-entered PO is removed.
 */
export const updateOrderDetailsSchema = z.object({
  client_name: z.string().min(1).max(100).optional(),
  po_number: z.string().max(50).optional().nullable(),
  remarks: remarkEnum.optional().nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
}).refine(remarksTextRefine, { message: "A reason is required for this remark type.", path: ["remarks_other_text"] });

/** Store header fields. Same null-clears-it convention on po_number. */
export const updateStoreSchema = z.object({
  store_name: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(100).optional(),
  po_number: z.string().max(50).optional().nullable(),
});

export const addStoreSchema = z.object({
  store_name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  po_number: z.string().max(50).optional().nullable(),
});

export const invoiceSchema = z.object({
  invoice_no: z.string().min(1).max(50),
  bill_amount: z.coerce.number().min(0),
  billing_date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Billing date cannot be in the future"),
  /** The stores this invoice covers. Its expected value is their combined billable total. */
  store_ids: z.array(z.number().int().positive()).min(1),
});

export const editBillingSchema = z.object({
  invoice_no: z.string().min(1).max(50).optional(),
  bill_amount: z.coerce.number().min(0).optional(),
  billing_date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Billing date cannot be in the future").optional(),
  /** Re-scoping which stores an invoice covers. Only while it is unpaid. */
  store_ids: z.array(z.number().int().positive()).min(1).optional(),
});

export const editPaymentSchema = z.object({
  amount_received: z.coerce.number().min(0).optional(),
  payment_date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Payment date cannot be in the future").optional(),
});

export const followUpSchema = z.object({
  note: z.string().min(1).max(1000),
});

export const closeOrderSchema = z.object({
  remarks: remarkEnum,
  remarks_other_text: z.string().max(500).optional().nullable(),
}).refine(remarksTextRefine, { message: "Text is required for this remark type.", path: ["remarks_other_text"] });

export const forceCloseOrderSchema = z.object({
  remarks: remarkEnum,
  remarks_other_text: z.string().max(500).optional().nullable(),
}).refine(remarksTextRefine, { message: "Text is required for this remark type.", path: ["remarks_other_text"] });

export const itemLossRemarkSchema = z.object({
  remarks: z.enum(["Reprint", "Sample", "UnderWarranty", "FreeOfCost", "Other"]).nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
}).refine(
  (data) => data.remarks !== "Other" || (data.remarks_other_text && data.remarks_other_text.trim().length > 0),
  { message: "Text is required when Other is selected.", path: ["remarks_other_text"] }
);

export const flagItemSchema = z.object({
  is_flagged: z.boolean(),
  flag_reason: z.string().max(500).optional().nullable(),
}).refine(
  (data) => !data.is_flagged || (data.flag_reason && data.flag_reason.trim().length > 0),
  { message: "A reason is required when flagging an item.", path: ["flag_reason"] }
);

export const assignItemSchema = z.object({
  // Full replacement of the item's assignee set; [] clears all assignments.
  assigned_to: z.array(z.number().int().positive()).max(20),
});

export const completeItemSchema = z.object({
  production_completed: z.boolean(),
});

export const markInstalledSchema = z.object({
  installed: z.boolean().optional().default(true),
});

export const paymentSchema = z.object({
  amount_received: z.coerce.number().min(0),
  payment_date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Payment date cannot be in the future"),
});

/** Single source of truth for assignable roles — keep in sync with the Prisma Role enum. */
export const roleEnum = z.enum([
  "ADMIN",
  "OPERATION_MANAGER",
  "CSM",
  "ACCOUNTS",
  "PRODUCTION",
  "PRODUCTION_MANAGER",
  "COST_CONTROL_MANAGER",
  "PASTER",
  "HELPER",
  "DRIVER",
]);

/** The roles an Operation Manager may hand out: field staff only. */
export const fieldRoleEnum = z.enum(["PASTER", "HELPER", "DRIVER"]);

/**
 * An Indian mobile number, normalised to E.164 (+91XXXXXXXXXX) so WhatsApp can use it
 * as-is. Accepts "98765 43210", "09876543210", "919876543210" and "+91 98765-43210".
 */
export const indianMobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .transform((v) => v.replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a 10-digit Indian mobile number")
  .transform((v) => `+91${v}`);

const empCode = z.string().trim().min(1).max(20);
const username = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores");

export const createFieldStaffSchema = z.object({
  name: z.string().trim().min(1).max(100),
  username,
  password: z.string().min(8),
  role: fieldRoleEnum,
  phone: indianMobile.optional().nullable(),
  emp_code: empCode.optional().nullable(),
});

export const updateFieldStaffSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: fieldRoleEnum.optional(),
  phone: indianMobile.optional().nullable(),
  emp_code: empCode.optional().nullable(),
});

export const areaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  locality: z.enum(["LOCAL", "NON_LOCAL"]),
  district: z.string().trim().max(100).optional().nullable(),
  needs_confirmation: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

export const vehicleSchema = z.object({
  reg_no: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, " ")),
  type: z.string().trim().min(1).max(50),
  usual_driver_id: z.number().int().positive().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
});

export const csmCodeSchema = z.object({
  code: z.string().trim().min(1).max(20).transform((v) => v.toUpperCase()),
  kind: z.enum(["CSM", "TEAM", "BRANCH", "UNKNOWN"]),
  label: z.string().trim().max(100).optional().nullable(),
  user_id: z.number().int().positive().optional().nullable(),
  is_active: z.boolean().optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores"),
  password: z.string().min(8),
  role: roleEnum,
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores"),
  role: roleEnum,
});

/** Admin-initiated password reset for another account. */
export const resetPasswordSchema = z.object({
  new_password: z.string().min(8),
});

export const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().min(10).max(20).optional().nullable(),
  photo_url: z.string().url().or(z.literal("")).optional().nullable(),
  current_password: z.string().optional(),
  new_password: z.string().min(8).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** A calendar day as "YYYY-MM-DD" that really exists (no 2026-02-30). */
const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Not a real date");

const optionalId = z.number().int().positive().optional().nullable();

export const workJobSchema = z
  .object({
    order_id: z.number().int().positive(),
    store_ids: z.array(z.number().int().positive()).max(50).default([]),
    start_date: dayString,
    end_date: dayString.optional().nullable(),
    csm_code_id: optionalId,
    csm2_code_id: optionalId,
    work_details: z.string().trim().min(3).max(500),
    area_id: z.number().int().positive(),
    vehicle_id: optionalId,
    route: z.string().trim().max(200).optional().nullable(),
    extra_tag: z.string().trim().max(20).optional().nullable(),
    instructions: z.string().trim().max(1000).optional().nullable(),
    allow_double_booking: z.boolean().default(false),
    member_ids: z.array(z.number().int().positive()).min(1, "Pick at least one person").max(5),
  })
  .refine((j) => !j.end_date || j.end_date >= j.start_date, { message: "End date cannot be before start date", path: ["end_date"] })
  .refine((j) => !j.csm2_code_id || j.csm2_code_id !== j.csm_code_id, { message: "CSM 2 must differ from the first CSM", path: ["csm2_code_id"] })
  .refine((j) => new Set(j.member_ids).size === j.member_ids.length, { message: "The same person is listed twice", path: ["member_ids"] });

export const workJobStatusSchema = z
  .object({
    status: z.enum(["ASSIGNED", "STARTED", "COMPLETED", "HOLD", "CANCELLED"]),
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .refine((v) => v.status !== "CANCELLED" || !!v.reason, { message: "Give a reason for cancelling", path: ["reason"] });

export const dayQuery = dayString;

/** Leave runs over whole days; to_date may be left out for one day. */
export const leaveSchema = z
  .object({
    user_id: z.number().int().positive(),
    from_date: dayString,
    to_date: dayString.optional().nullable(),
    reason: z.string().trim().max(300).optional().nullable(),
    /** Save even though the person is already on jobs over these dates. */
    acknowledge_jobs: z.boolean().default(false),
  })
  .refine((l) => !l.to_date || l.to_date >= l.from_date, { message: "To date cannot be before from date", path: ["to_date"] });

export const leaveCancelSchema = z.object({
  reason: z.string().trim().min(2, "Give a reason for cancelling").max(300),
});

/** "HH:MM", 24-hour. */
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

const overtimeFields = {
  work_date: dayString,
  start_time: clockTime,
  end_time: clockTime,
  work_job_id: optionalId,
  csm_code_id: optionalId,
  remarks: z.string().trim().max(500).optional().nullable(),
};
const differentTimes = { message: "Start and close times cannot be the same", path: ["end_time"] };

/** One form can log the same stretch for several people (e.g. a paster and a helper). */
export const overtimeSchema = z
  .object({
    ...overtimeFields,
    user_ids: z.array(z.number().int().positive()).min(1, "Pick at least one person").max(5),
  })
  .refine((o) => o.start_time !== o.end_time, differentTimes)
  .refine((o) => new Set(o.user_ids).size === o.user_ids.length, { message: "The same person is listed twice", path: ["user_ids"] });

export const overtimeUpdateSchema = z
  .object({ ...overtimeFields, user_id: z.number().int().positive() })
  .refine((o) => o.start_time !== o.end_time, differentTimes);

export const overtimeDecisionSchema = z
  .object({
    ids: z.array(z.number().int().positive()).min(1).max(200),
    status: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().trim().max(300).optional().nullable(),
  })
  .refine((d) => d.status !== "REJECTED" || !!d.reason, { message: "Give a reason for rejecting", path: ["reason"] });
