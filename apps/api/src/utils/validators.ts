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
}).refine(itemRemarkRefine, itemRemarkRefineConfig);

const REMARKS_REQUIRING_TEXT = new Set(["Other", "Revised", "ExtraAmount", "LessAmount"]);
const remarksTextRefine = (data: { remarks?: string | null; remarks_other_text?: string | null }) =>
  !data.remarks || !REMARKS_REQUIRING_TEXT.has(data.remarks) ||
  !!(data.remarks_other_text && data.remarks_other_text.trim().length > 0);

export const createOrderSchema = z.object({
  client_name: z.string().min(1).max(100),
  store_name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Date cannot be in the future"),
  po_number: z.string().max(50).optional().nullable(),
  remarks: remarkEnum.optional().nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
  items: z.array(orderItemSchema).min(1),
}).refine(remarksTextRefine, { message: "A reason is required for this remark type.", path: ["remarks_other_text"] });

export const updateOrderSchema = z.object({
  client_name: z.string().min(1).max(100),
  store_name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Date cannot be in the future"),
  po_number: z.string().max(50).optional().nullable(),
  remarks: remarkEnum.optional().nullable(),
  remarks_other_text: z.string().max(500).optional().nullable(),
  items: z.array(updateOrderItemSchema).min(1),
}).refine(remarksTextRefine, { message: "A reason is required for this remark type.", path: ["remarks_other_text"] });

export const invoiceSchema = z.object({
  invoice_no: z.string().min(1).max(50),
  bill_amount: z.coerce.number().min(0),
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

export const paymentSchema = z.object({
  amount_received: z.coerce.number().min(0),
  payment_date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Payment date cannot be in the future"),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores"),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "EMPLOYEE", "ACCOUNTS", "PRODUCTION", "OPERATOR"]),
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
