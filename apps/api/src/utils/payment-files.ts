/**
 * Bills, photos and receipts on payment requests: what may be uploaded, by whom, and where
 * the bytes are kept.
 *
 * Storage: the API runs on Render, whose disk is wiped on every restart, so files cannot
 * live on disk. They go in Postgres (PaymentAttachmentBlob) for now. Cloudflare R2 can
 * replace that behind FileStore once a bucket and keys exist; `PaymentAttachment.storage`
 * records which store holds each file, so both can be read side by side.
 */

import type { PaymentAttachmentKind, PaymentRequestStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { isReviewerRole, type Actor } from "./payment-workflow";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Live (not removed) files per request. */
export const MAX_FILES_PER_REQUEST = 10;
export const MAX_FILE_LABEL = "5 MB";

export const ATTACHMENT_KIND_LABELS: Record<PaymentAttachmentKind, string> = {
  BILL: "Bill",
  PHOTO: "Photo",
  RECEIPT: "Payment receipt",
};

/* ------------------------------------------------------------------ type check */

export type AllowedMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf";

/** HEIF brands phones write for photos (iPhone "heic", generic "mif1" …). */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * The file's real type, read from its first bytes. The name and the browser's declared type
 * are ignored: a renamed .exe is still refused, and a JPEG called bill.pdf is stored as a JPEG.
 */
export function detectFileType(buf: Buffer): AllowedMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (buf.toString("latin1", 4, 8) === "ftyp" && HEIF_BRANDS.has(buf.toString("latin1", 8, 12))) return "image/heic";
  return null;
}

/* ------------------------------------------------------------------ who */

/** Statuses after which a request's files are frozen. */
const FROZEN: PaymentRequestStatus[] = ["CLOSED", "REJECTED", "CANCELLED"];

interface FileRequest {
  status: PaymentRequestStatus;
  requested_by: number;
}

/**
 * The kinds of file this actor may add to this request now. Requesters add bills and
 * photos to their own request; the Admin and Cost Control can add bills and photos too,
 * and Cost Control alone adds the payment receipt. Nothing is added once it is closed,
 * rejected or cancelled.
 */
export function attachKindsFor(r: FileRequest, a: Actor): PaymentAttachmentKind[] {
  if (FROZEN.includes(r.status)) return [];
  if (a.role === "COST_CONTROL_MANAGER") return ["BILL", "PHOTO", "RECEIPT"];
  if (a.role === "ADMIN" || r.requested_by === a.id) return ["BILL", "PHOTO"];
  return [];
}

/** Whoever added a file, or a reviewer, may remove it while the request is still open. */
export function canRemoveFile(r: FileRequest, file: { uploaded_by: number | null }, a: Actor): boolean {
  if (FROZEN.includes(r.status)) return false;
  return file.uploaded_by === a.id || isReviewerRole(String(a.role));
}

/* ------------------------------------------------------------------ storage */

export interface FileStore {
  name: "db" | "r2";
  /** Save the bytes for an attachment row; returns the storage key, if the store uses one. */
  put(tx: Prisma.TransactionClient, attachmentId: number, data: Buffer): Promise<string | null>;
  get(file: { id: number; storage_key: string | null }): Promise<Buffer | null>;
}

const dbStore: FileStore = {
  name: "db",
  async put(tx, attachmentId, data) {
    await tx.paymentAttachmentBlob.create({ data: { attachment_id: attachmentId, data } });
    return null;
  },
  async get(file) {
    const blob = await prisma.paymentAttachmentBlob.findUnique({ where: { attachment_id: file.id } });
    return blob ? Buffer.from(blob.data) : null;
  },
};

const STORES: Record<string, FileStore> = { db: dbStore };

/** The store new files go to. */
export const currentStore = (): FileStore => dbStore;

/** The store holding an existing file. */
export function storeFor(name: string): FileStore {
  const store = STORES[name];
  if (!store) throw new Error(`No file store "${name}" is configured`);
  return store;
}

/* ------------------------------------------------------------------ names */

/** A stored display name: no path, no control characters, at most 120 characters. */
export function cleanFileName(raw: unknown): string {
  const base = String(raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim();
  return (base || "file").slice(0, 120);
}

/** Content-Disposition with an ASCII fallback and the real name in UTF-8. */
export function contentDisposition(name: string, download: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
