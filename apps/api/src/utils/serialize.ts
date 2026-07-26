import { Prisma } from "@prisma/client";

/**
 * Recursively walks an object or array and converts any Prisma.Decimal instance
 * to a native JavaScript Number, ensuring JSON serialization sends real numbers.
 */
export function serializeDecimals<T>(obj: T): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof Prisma.Decimal) {
    return obj.toNumber();
  }

  // Handle case where Decimal might be a plain object after some transformations
  if (typeof obj === "object" && obj !== null && "d" in obj && "e" in obj && "s" in obj) {
    try {
      return new Prisma.Decimal(obj as any).toNumber();
    } catch {
      // If it fails to parse as decimal, fall through
    }
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeDecimals);
  }

  if (typeof obj === "object") {
    // Preserve Date objects
    if (obj instanceof Date) {
      return obj;
    }

    const serialized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeDecimals(value);
    }
    return serialized;
  }

  return obj;
}
