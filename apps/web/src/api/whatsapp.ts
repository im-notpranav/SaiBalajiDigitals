import { apiFetch } from "./client";
import type { UserRole } from "@sb-oms/shared-types";

export type WhatsAppStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED" | "LOGGED";

export const WA_STATUS_LABELS: Record<WhatsAppStatus, string> = {
  LOGGED: "Logged",
  QUEUED: "Waiting",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Failed",
  SKIPPED: "Not sent",
};

export interface WhatsAppMessage {
  id: number;
  event: string;
  template: string;
  user: { id: number; name: string; role: UserRole } | null;
  to_phone: string | null;
  preview: string;
  /** Full "Open in app" link. */
  link: string | null;
  ref_type: string | null;
  ref_id: number | null;
  status: WhatsAppStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  can_retry: boolean;
}

export interface WhatsAppLog {
  messages: WhatsAppMessage[];
  total: number;
  page: number;
  page_size: number;
  counts_30d: Record<WhatsAppStatus, number>;
}

export interface WhatsAppSetup {
  mode: "live" | "log";
  live: boolean;
  token_set: boolean;
  webhook_secret_set: boolean;
  send_host: string;
  webhook_path: string;
  app_url: string;
  button: { text: string; url: string };
  templates: {
    event: string;
    template: string;
    body: string;
    vars: string[];
    button_sample: string;
    category: string;
    language: string;
  }[];
  people: {
    active: number;
    with_phone: number;
    opted_out: number;
    missing_phone: { id: number; name: string; role: UserRole }[];
  };
}

export function fetchWhatsAppSetup() {
  return apiFetch<WhatsAppSetup>("/whatsapp/setup");
}

export function fetchWhatsAppLog(params: { status?: WhatsAppStatus | ""; q?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  const s = qs.toString();
  return apiFetch<WhatsAppLog>(`/whatsapp/messages${s ? `?${s}` : ""}`);
}

export function retryWhatsApp(id: number) {
  return apiFetch<{ status: WhatsAppStatus; message: string }>(`/whatsapp/messages/${id}/retry`, { method: "POST" });
}
