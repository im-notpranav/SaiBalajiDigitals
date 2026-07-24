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

export const orderItemSchema = z.object({
  media: z.string().min(1).max(200),
  width_inches: z.coerce.number().positive(),
  height_inches: z.coerce.number().positive(),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().positive(),
});

export const createOrderSchema = z.object({
  client_name: z.string().min(1).max(100),
  store_name: z.string().min(1).max(100),
  location: z.string().min(1).max(100),
  date: z.coerce.date().refine((d) => d <= new Date(), "Date cannot be in the future"),
  po_number: z.string().max(50).optional().nullable(),
  remarks: remarkEnum.optional().nullable(),
  items: z.array(orderItemSchema).min(1),
});

export const updateOrderSchema = createOrderSchema;

export const invoiceSchema = z.object({
  invoice_no: z.string().min(1).max(50),
  bill_amount: z.coerce.number().min(0),
});

export const closeOrderSchema = z.object({
  remarks: remarkEnum.optional().nullable(),
  other_remark: z.string().max(500).optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, numbers, or underscores"),
  password: z.string().min(8),
  role: z.enum(["employee", "accountant", "production"]),
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
