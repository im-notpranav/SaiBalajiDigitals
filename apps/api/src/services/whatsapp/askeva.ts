/**
 * The only file that knows about AskEva. Business code queues messages in the outbox;
 * the sender calls `sendTemplate` here. Swapping provider means replacing this file.
 *
 * AskEva's own API pages are offline, so the request shape follows a published client
 * (POST {send-url}?token=…, Meta Cloud API template body). Confirm it with AskEva before
 * switching WHATSAPP_MODE to live.
 */
import { ASKEVA_SEND_URL, ASKEVA_TOKEN } from "../../utils/config";

export interface TemplateMessage {
  /** E.164, e.g. +919876543210. */
  to: string;
  template: string;
  language: string;
  params: string[];
  /** Value for the template's dynamic URL button ({{1}} at the end of its URL), if any. */
  link?: string | null;
}

/** Why a send failed, and whether trying again later could help. */
export class ProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/** Finds the message id in the reply, wherever AskEva puts it. */
function providerIdOf(body: any): string | null {
  const id = body?.messages?.[0]?.id ?? body?.data?.messages?.[0]?.id ?? body?.message_id ?? body?.data?.id ?? body?.id;
  return typeof id === "string" && id ? id : null;
}

export async function sendTemplate(msg: TemplateMessage): Promise<{ providerId: string | null }> {
  const components: object[] = [];
  if (msg.params.length) components.push({ type: "body", parameters: msg.params.map((text) => ({ type: "text", text })) });
  if (msg.link) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: msg.link }] });
  const payload = {
    to: msg.to.replace(/^\+/, ""),
    type: "template",
    template: {
      name: msg.template,
      language: { policy: "deterministic", code: msg.language },
      ...(components.length ? { components } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(`${ASKEVA_SEND_URL}?token=${encodeURIComponent(ASKEVA_TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: any) {
    // Network trouble or timeout: worth another go. The URL (with the token) is never logged.
    throw new ProviderError(err?.name === "TimeoutError" ? "AskEva did not answer in time" : "Could not reach AskEva", true);
  }

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const detail = String(body?.error?.message ?? body?.message ?? body?.error ?? text ?? "").slice(0, 300);

  if (!res.ok) {
    // Busy or broken on their side: retry. A bad number, template or token: retrying won't help.
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(`AskEva ${res.status}${detail ? `: ${detail}` : ""}`, retryable);
  }
  if (body && (body.error || body.success === false || body.status === "error")) {
    throw new ProviderError(`AskEva refused the message${detail ? `: ${detail}` : ""}`, false);
  }
  return { providerId: providerIdOf(body) };
}
