/**
 * Free-Trial Token Budget
 *
 * Daily per-user token quota for free-trial usage of provider env keys.
 * Backed by Upstash Redis with 24h TTL. `useFreeTrial=true` now means
 * "subject to this quota" — not "always free".
 *
 * Falls back to an in-memory map when Upstash env vars are missing
 * (dev convenience; resets on process restart).
 */

import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const DAILY_BUDGET = Number(process.env.FREE_TRIAL_DAILY_TOKEN_BUDGET ?? 500_000);
const TTL_SECONDS = 24 * 60 * 60;

const memoryUsage = new Map<string, { tokens: number; expiresAt: number }>();

function dayBucket(): string {
  // YYYY-MM-DD in UTC; key resets daily even if Redis SET ... EX is missed.
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function bucketKey(userKey: string): string {
  return `budget:free-trial:${dayBucket()}:${userKey}`;
}

/**
 * Returns true if the user still has budget remaining.
 * Pure read — does not consume budget. Pair with `recordUsage` after the call.
 */
export async function checkBudget(userKey: string): Promise<boolean> {
  if (DAILY_BUDGET <= 0) return true;
  const key = bucketKey(userKey);

  if (redis) {
    const used = (await redis.get<number>(key)) ?? 0;
    return used < DAILY_BUDGET;
  }

  const entry = memoryUsage.get(key);
  if (!entry) return true;
  if (Date.now() > entry.expiresAt) {
    memoryUsage.delete(key);
    return true;
  }
  return entry.tokens < DAILY_BUDGET;
}

/**
 * Record token usage against the user's daily budget.
 * Best-effort — failures are logged by the caller, not thrown.
 */
export async function recordUsage(userKey: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  const key = bucketKey(userKey);

  if (redis) {
    const total = await redis.incrby(key, tokens);
    // Set TTL only on first write of the day (when total === tokens).
    if (total === tokens) {
      await redis.expire(key, TTL_SECONDS);
    }
    return;
  }

  const entry = memoryUsage.get(key);
  if (entry && Date.now() <= entry.expiresAt) {
    entry.tokens += tokens;
  } else {
    memoryUsage.set(key, { tokens, expiresAt: Date.now() + TTL_SECONDS * 1000 });
  }
}
