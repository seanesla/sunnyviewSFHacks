type AnyRedis = {
  get: <T = unknown>(key: string) => Promise<T | null>
  set: (key: string, value: unknown, opts?: { ex?: number }) => Promise<unknown>
}

let redisPromise: Promise<AnyRedis | null> | null = null

export async function getRedis(): Promise<AnyRedis | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null

  if (!redisPromise) {
    redisPromise = (async () => {
      try {
        // Optional dependency. If not installed, this import will fail and Redis caching is disabled.
        // @ts-ignore
        const mod = (await import("@upstash/redis")) as any
        const Redis = mod?.Redis
        if (!Redis) return null
        return new Redis({ url, token }) as AnyRedis
      } catch {
        // Optional dependency: if not installed, just disable Redis caching.
        return null
      }
    })()
  }

  return redisPromise
}
