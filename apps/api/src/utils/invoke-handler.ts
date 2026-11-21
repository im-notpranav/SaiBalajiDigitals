import type { Request, Response } from "express";
import type { AuthUser } from "../middlewares/auth.middleware";

export interface InvokeResult {
  status: number;
  body: any;
}

/**
 * Runs an Express handler in-process as `user`, and returns what it answered. Used when an
 * admin approves a CSM's change request: the change is applied through the very handlers an
 * admin's own edit would use, so every rule (Master Library names, store clashes, billing
 * locks, change logs, status recompute) applies the same way.
 */
export function invokeHandler(
  handler: (req: Request, res: Response) => unknown,
  user: AuthUser,
  input: { params?: Record<string, string>; body?: unknown; query?: Record<string, string> },
): Promise<InvokeResult> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let settled = false;
    const done = (body: unknown) => {
      if (settled) return;
      settled = true;
      resolve({ status: statusCode, body });
    };
    const res: any = {
      status(code: number) { statusCode = code; return res; },
      json(body: unknown) { done(body); return res; },
      send(body: unknown) { done(body); return res; },
      set() { return res; },
      setHeader() { return res; },
      end() { done(undefined); return res; },
    };
    const req: any = { params: input.params ?? {}, body: input.body ?? {}, query: input.query ?? {}, user, headers: {}, ip: "internal" };
    Promise.resolve(handler(req, res)).then(() => done(undefined), reject);
  });
}
