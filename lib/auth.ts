import { timingSafeEqual } from "node:crypto";

/** Compares "Bearer <token>" against an env var without leaking timing. */
export function hasBearer(header: string | null, expected: string | undefined): boolean {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
