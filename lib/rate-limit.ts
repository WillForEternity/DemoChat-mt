/**
 * Rate Limit Helper
 *
 * Per-user / per-IP token-bucket rate limiting via Upstash Redis.
 * Kept deliberately separate from `auth-helper.ts` so the pure
 * `resolveApiKey` decision logic stays free of side effects.
 *
 * Falls back to a permissive in-memory limiter when Upstash env vars
 * are missing — this lets local dev work without spinning up Redis.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

let limiter: Ratelimit | null = null;

if (url && token) {
  const redis = new Redis({ url, token });
  limiter = new Ratelimit({
    redis,
    // 30 PDF parse requests per minute per user — generous enough for
    // Phase 4's parallel sub-PDF workers (concurrency=4) to never trip it
    // legitimately, but tight enough to defang abuse.
    limiter: Ratelimit.slidingWindow(30, "60 s"),
    analytics: false,
    prefix: "ratelimit:parse-pdf",
  });
}

// In-memory fallback so dev environments without Upstash still work.
const memoryHits = new Map<string, number[]>();
const MEMORY_WINDOW_MS = 60_000;
const MEMORY_LIMIT = 30;

export interface RateLimitResult {
  success: boolean;
  /** Epoch ms when the window resets (informational; in-memory is approximate). */
  reset: number;
}

export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  if (limiter) {
    const r = await limiter.limit(key);
    return { success: r.success, reset: r.reset };
  }

  const now = Date.now();
  const windowStart = now - MEMORY_WINDOW_MS;
  const hits = (memoryHits.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= MEMORY_LIMIT) {
    return { success: false, reset: hits[0] + MEMORY_WINDOW_MS };
  }
  hits.push(now);
  memoryHits.set(key, hits);
  return { success: true, reset: now + MEMORY_WINDOW_MS };
}
