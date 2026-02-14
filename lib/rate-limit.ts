type RateBucket = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  ok: boolean
  retryAfterSec: number
}

const MAX_BUCKETS = 4000

function bucketMap() {
  const g = globalThis as unknown as { __sunnyviewRateLimitBuckets?: Map<string, RateBucket> }
  if (!g.__sunnyviewRateLimitBuckets) g.__sunnyviewRateLimitBuckets = new Map()
  return g.__sunnyviewRateLimitBuckets
}

function trimBuckets(now: number) {
  const buckets = bucketMap()
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) buckets.delete(key)
  }

  while (buckets.size > MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value
    if (!oldestKey) break
    buckets.delete(oldestKey)
  }
}

export function takeRateLimitToken(opts: { key: string; limit: number; windowMs: number }): RateLimitResult {
  const now = Date.now()
  trimBuckets(now)

  const buckets = bucketMap()
  const existing = buckets.get(opts.key)
  const active = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + opts.windowMs } : existing

  if (active.count >= opts.limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((active.resetAt - now) / 1000)),
    }
  }

  active.count += 1
  buckets.set(opts.key, active)
  return { ok: true, retryAfterSec: 0 }
}

export function requestClientKey(headers: Headers) {
  const xff = headers.get("x-forwarded-for")
  const first = xff?.split(",")[0]?.trim()
  if (first) return first
  return headers.get("x-real-ip")?.trim() || "unknown"
}
