import { z } from "zod";

export const remarkEnum = z.enum([
  "Reprint",
  "Sample",
  "UnderWarranty",
  "Revised",
  "ExtraAmount",
  "LessAmount",
  "FreeOfCost",
]);

export const closureRemarkEnum = z.enum([
  "Delivered",
  "CustomerCancelled",
  "DuplicateOrder",
  "PaymentCleared",
  "CustomReason",
]);

export const productionRemarkEnum = z.enum([
  "Clarification",
  "InternalNote",
  "CustomerUpdate",
  "ProductionHandoff",
  "QCHold",
]);

export const orderItemSchema = z.object({
  media: z.string().min(1).max(200),
  width_inches: z.coerce.number().positive(),
  height_inches: z.coerce.number().positive(),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().positive(),
  remarks: remarkEnum.optional().nullable(),
});

export const createOrderSchema = z.object({
  client_name: z.string().min(1).max(100),
  store_name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  // Add 1 day padding to account for timezone differences
  date: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86400000, "Date cannot be in the future"),
  po_number: z.string().max(50).optional().nullable(),
  items: z.array(orderItemSchema).min(1),
});

export const updateOrderSchema = createOrderSchema;

export const invoiceSchema = z.object({
  invoice_no: z.string().min(1).max(50),
  bill_amount: z.coerce.number().min(0),
});

export const closeOrderSchema = z.object({
  closure_remark_type: closureRemarkEnum,
  closure_remark_text: z.string().max(500).optional().nullable(),
}).refine(
  (data) => data.closure_remark_type !== "CustomReason" || (data.closure_remark_text && data.closure_remark_text.trim().length > 0),
  {
    message: "Text is required when Custom Reason is selected.",
    path: ["closure_remark_text"],
  }
);

export const advanceOrderSchema = z.object({
  production_remark_type: productionRemarkEnum,
  production_remark_text: z.string().max(500).optional().nullable(),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores"),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "EMPLOYEE", "ACCOUNTS", "PRODUCTION"]),
});

export const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  current_password: z.string().optional(),
  new_password: z.string().min(8).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
