import { AwsClient } from "aws4fetch";
import { NODE_ENV, R2_ACCESS_KEY_ID, R2_ACCOUNT_ID, R2_BUCKET, R2_ENABLED, R2_PREFIX, R2_SECRET_ACCESS_KEY } from "./config";

/**
 * Where uploaded files live: Cloudflare R2, spoken to over its S3 API. Tests keep files in
 * memory, so they never touch the network or the real bucket. Every key gets R2_PREFIX, which
 * keeps local files apart from production's when both share one bucket.
 */
export interface ObjectStore {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  /** The bytes, or null when no such object exists. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 30_000;

function r2Store(): ObjectStore {
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
    retries: 2,
  });
  const url = (key: string) =>
    `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${R2_PREFIX}${key.split("/").map(encodeURIComponent).join("/")}`;
  const call = (key: string, init: RequestInit) =>
    client.fetch(url(key), { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  return {
    async put(key, data, mime) {
      const res = await call(key, { method: "PUT", body: data as unknown as BodyInit, headers: { "Content-Type": mime } });
      if (!res.ok) throw new Error(`R2 refused the upload of ${key}: ${res.status}`);
    },
    async get(key) {
      const res = await call(key, { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 refused the download of ${key}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(key) {
      const res = await call(key, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`R2 refused to delete ${key}: ${res.status}`);
    },
  };
}

function memoryStore(): ObjectStore {
  const files = new Map<string, Buffer>();
  return {
    async put(key, data) {
      files.set(key, data);
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async remove(key) {
      files.delete(key);
    },
  };
}

/** Null when no store is set up: uploads are refused, and the rest of the app carries on. */
export const objectStore: ObjectStore | null = NODE_ENV === "test" ? memoryStore() : R2_ENABLED ? r2Store() : null;
