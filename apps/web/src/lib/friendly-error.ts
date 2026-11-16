/**
 * One place that turns a failed request into words a person can act on.
 *
 * The server already writes most of its own messages ("Invalid username or password").
 * What staff must never see is the browser's own text, such as
 * "Request failed with status code 401" or "Network Error". The API client runs every
 * failure through here and puts the result on `error.message`, so any screen that shows
 * `err.message` shows plain words.
 */

export const SERVER_FAULT_TEXT =
  "Something went wrong on our side. Please try again. If it keeps happening, tell the admin.";

export const SESSION_EXPIRED_TEXT = "Your session expired. Please sign in again.";

const OFFLINE_TEXT = "Can't reach the server. Check your internet connection and try again.";
const TIMEOUT_TEXT = "The server is taking too long to answer. Please try again.";

/** What to say for a status when the server sent no message of its own. */
const STATUS_TEXT: Record<number, string> = {
  400: "Some details are missing or not right. Please check and try again.",
  401: SESSION_EXPIRED_TEXT,
  403: "You don't have permission to do this.",
  404: "We couldn't find that. It may have been removed.",
  408: TIMEOUT_TEXT,
  409: "Someone else changed this just now. Refresh the page and try again.",
  413: "That file is too large. Please choose a smaller one.",
  415: "That file type isn't supported.",
  422: "Some details are missing or not right. Please check and try again.",
  429: "Too many tries. Please wait a few minutes and try again.",
};

/** Words that are the browser's or the framework's, never a message meant for a person. */
const RAW_TEXT = [
  /^Request failed with status code \d+$/i,
  /^Network Error$/i,
  /^timeout of \d+ms exceeded$/i,
  /^Internal server error$/i,
  /^Failed to fetch$/i,
  /^Load failed$/i,
  /^NetworkError when attempting to fetch resource\.?$/i,
  /^Unexpected token .* JSON/i,
  /^Not authenticated$/i,
];

const isRaw = (text: string) => RAW_TEXT.some((re) => re.test(text.trim()));

type ErrorShape = {
  message?: unknown;
  code?: unknown;
  isAxiosError?: boolean;
  response?: { status?: number; data?: unknown };
};

function fromStatus(status: number | undefined): string | undefined {
  if (!status) return undefined;
  if (status >= 500) return SERVER_FAULT_TEXT;
  return STATUS_TEXT[status];
}

/**
 * Validation lines come as "client_name: Required" or "items.0.qty: ...".
 * Show "Client name: Required" and "Items 1 qty: ..." instead.
 */
function readableField(line: string): string {
  const at = line.indexOf(": ");
  if (at <= 0) return line;
  const field = line
    .slice(0, at)
    .split(".")
    .map((part) => (/^\d+$/.test(part) ? String(Number(part) + 1) : part))
    .join(" ")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  if (field === "input") return line.slice(at + 2);
  return field.charAt(0).toUpperCase() + field.slice(1) + line.slice(at);
}

/** The server's own words, when it sent some that a person can read. */
function serverWords(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const { message, errors } = data as { message?: unknown; errors?: unknown };
  if (Array.isArray(errors) && errors.length && errors.every((e) => typeof e === "string")) {
    return errors.map(readableField).join(". ");
  }
  if (typeof message === "string" && message.trim() && !isRaw(message)) return message;
  return undefined;
}

/**
 * Plain words for any thrown value. `fallback` is used only when nothing better is known,
 * so callers can say what they were doing ("Could not save the PO").
 */
export function friendlyError(err: unknown, fallback = SERVER_FAULT_TEXT): string {
  if (!err) return fallback;
  if (typeof err === "string") return isRaw(err) ? fallback : err;

  const e = err as ErrorShape;

  const said = serverWords(e.response?.data);
  if (said) return said;

  if (e.response) return fromStatus(e.response.status) ?? fallback;

  // No response at all: the request never reached the server, or it gave up waiting.
  if (e.code === "ERR_CANCELED") return fallback;
  if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return TIMEOUT_TEXT;
  if (e.isAxiosError || (typeof e.message === "string" && isRaw(e.message))) return OFFLINE_TEXT;

  // An Error our own code threw on purpose already carries readable words.
  if (typeof e.message === "string" && e.message.trim()) return e.message;
  return fallback;
}
