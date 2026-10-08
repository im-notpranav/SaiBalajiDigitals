import { ZodError } from "zod";

/**
 * Converts Zod validation errors into user-friendly messages, stripping
 * internal schema paths and type names that could leak implementation details.
 */
export function sanitizeZodErrors(error: ZodError): string[] {
  return error.errors.map((e) => {
    const field = e.path.length > 0 ? e.path.join(".") : "input";
    return `${field}: ${e.message}`;
  });
}
