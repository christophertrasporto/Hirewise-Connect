/**
 * In-process sliding-window rate limiter for auth and upload endpoints.
 * Good enough for a single web instance; swap the store for Redis or a DB table
 * when running several instances.
 */
type Bucket = { hits: number[]; };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super("Too many attempts. Try again later.");
    this.name = "RateLimitedError";
  }
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): void {
  if (buckets.size > MAX_KEYS) buckets.clear();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    const retry = Math.ceil((windowMs - (now - b.hits[0])) / 1000);
    buckets.set(key, b);
    throw new RateLimitedError(Math.max(1, retry));
  }
  b.hits.push(now);
  buckets.set(key, b);
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}
