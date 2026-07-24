import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

export interface JwtPayload {
  id: number;
  username: string;
  name: string;
  role: Role;
}

const secret = process.env.JWT_SECRET!;
const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}

export const COOKIE_NAME = "token";

export function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
