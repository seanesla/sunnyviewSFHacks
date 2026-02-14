import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

export const runtime = "nodejs"

const LOG_PREFIX = "[forecast]"

const QuerySchema = z.object({
  lat: z.coerce.number().refine((v) => Number.isFinite(v) && Math.abs(v) <= 90),
  lng: z.coerce.number().refine((v) => Number.isFinite(v) && Math.abs(v) <= 180),
  dcKw: z.coerce.number().refine((v) => Number.isFinite(v) && v >= 0),
  lossesPct: z.coerce.number().optional(),
})

type ForecastDay = {
  date: string
  irradianceKwhM2: number | null
  cloudCoverPct: number | null
  estKwh: number
}

type CacheEntry = { t: number; payload: unknown }
const MEM_TTL_MS = 20 * 60 * 1000

function memCache() {
  const g = globalThis as unknown as { __sunnyviewForecastCache?: Map<string, CacheEntry> }
  if (!g.__sunnyviewForecastCache) g.__sunnyviewForecastCache = new Map()
  return g.__sunnyviewForecastCache
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeWorthIt(days: ForecastDay[], dcKw: number, lossesPct: number) {
  const sum7 = days.reduce((s, d) => s + (Number.isFinite(d.estKwh) ? d.estKwh : 0), 0)
  const avgDaily = sum7 / Math.max(1, days.length)
  const annualFromForecast = avgDaily * 365

  const rate = 0.25
  const costPerW = 2.75
  const installCost = dcKw * 1000 * costPerW
  const annualSavings = annualFromForecast * rate
  const paybackYears = annualSavings > 0 ? installCost / annualSavings : Infinity

  const verdict = paybackYears < 9 ? "good" : paybackYears < 14 ? "maybe" : "unlikely"
  const reasons = [
    `Forecast average: ${avgDaily.toFixed(1)} kWh/day for your current layout.`,
    `Assumes losses ${lossesPct}% and utility rate $${rate.toFixed(2)}/kWh.`,
    verdict === "good"
      ? `Estimated simple payback ~${paybackYears.toFixed(1)} years (typical install cost assumption).`
      : verdict === "maybe"
        ? `Estimated simple payback ~${paybackYears.toFixed(1)} years; economics depend on incentives and your rate plan.`
        : "Estimated payback is long; incentives, shading, or higher rates could change this.",
  ]

  return {
    verdict,
    paybackYears: Number.isFinite(paybackYears) ? paybackYears : null,
    annualKwhEst: annualFromForecast,
    annualSavingsUsd: annualSavings,
    installCostUsd: installCost,
    reasons,
  }
}

function buildFallbackDays(opts: { dcKw: number; pr: number }) {
  const baseIrr = 4.2
  const dayFactors = [0.92, 1.04, 1.08, 0.96, 1.01, 0.93, 1.05]
  const cloudByDay = [42, 35, 28, 48, 39, 46, 31]
  const start = new Date()

  const days: ForecastDay[] = dayFactors.map((factor, idx) => {
    const d = new Date(start)
    d.setDate(start.getDate() + idx)
    const date = d.toISOString().slice(0, 10)
    const irradianceKwhM2 = Number((baseIrr * factor).toFixed(3))
    const estKwh = opts.dcKw * irradianceKwhM2 * opts.pr
    return {
      date,
      irradianceKwhM2,
      cloudCoverPct: cloudByDay[idx] ?? null,
      estKwh,
    }
  })

  return days
}

export async function GET(req: NextRequest) {
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 })
  }

  const { lat, lng, dcKw } = parsed.data
  const lossesPct = clamp(parsed.data.lossesPct ?? 14, 0, 35)
  const pr = clamp(1 - lossesPct / 100, 0.5, 0.95)

  console.info(`${LOG_PREFIX} request`, {
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    dcKw: Number(dcKw.toFixed(3)),
    lossesPct,
  })

  const key = `f:${lat.toFixed(4)}:${lng.toFixed(4)}`
  const now = Date.now()
  const mem = memCache()
  const hit = mem.get(key)
  if (hit && now - hit.t < MEM_TTL_MS) {
    const cached = hit.payload as { days: ForecastDay[]; meta: Record<string, unknown>; worthIt: Record<string, unknown> }
    const days = cached.days.map((d) => {
      const irr = d.irradianceKwhM2
      const estKwh = irr ? dcKw * irr * pr : 0
      return { ...d, estKwh }
    })
    console.info(`${LOG_PREFIX} cache hit`, { key, days: days.length })
    return NextResponse.json({ ...cached, days }, { status: 200 })
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast")
  url.searchParams.set("latitude", String(lat))
  url.searchParams.set("longitude", String(lng))
  url.searchParams.set("timezone", "auto")
  url.searchParams.set("forecast_days", "7")
  url.searchParams.set("daily", "shortwave_radiation_sum,cloudcover_mean")

  for (let attempt = 1; attempt <= 2; attempt++) {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5500)
    const startedAt = Date.now()

    try {
      const res = await fetch(url.toString(), {
        signal: ac.signal,
        headers: { accept: "application/json" },
        cache: "no-store",
      })

      const durationMs = Date.now() - startedAt
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        console.warn(`${LOG_PREFIX} upstream non-200`, {
          attempt,
          status: res.status,
          durationMs,
          details: text.slice(0, 220),
        })
        if (attempt < 2 && (res.status >= 500 || res.status === 429)) {
          await wait(220)
          continue
        }
        throw new Error(`Forecast failed (${res.status})`)
      }

      const json = (await res.json().catch(() => null)) as any

      const times: string[] = Array.isArray(json?.daily?.time) ? json.daily.time : []
      const sw: Array<number | null> = Array.isArray(json?.daily?.shortwave_radiation_sum)
        ? json.daily.shortwave_radiation_sum.map((v: any) => (Number.isFinite(Number(v)) ? Number(v) : null))
        : []
      const cc: Array<number | null> = Array.isArray(json?.daily?.cloudcover_mean)
        ? json.daily.cloudcover_mean.map((v: any) => (Number.isFinite(Number(v)) ? Number(v) : null))
        : []

      const days: ForecastDay[] = times.slice(0, 7).map((date, i) => {
        const swMj = sw[i] ?? null
        const irrKwh = swMj !== null ? swMj * 0.2777777778 : null
        const estKwh = irrKwh ? dcKw * irrKwh * pr : 0
        return {
          date,
          irradianceKwhM2: irrKwh,
          cloudCoverPct: cc[i] ?? null,
          estKwh,
        }
      })

      if (!days.length) {
        throw new Error("Forecast payload missing daily data")
      }

      const worthIt = computeWorthIt(days, dcKw, lossesPct)
      const payload = {
        days: days.map((d) => ({ ...d, estKwh: 0 })),
        meta: {
          source: "open-meteo",
          units: { shortwave_radiation_sum: "MJ/m^2", irradianceKwhM2: "kWh/m^2" },
          pr,
        },
        worthIt,
      }

      mem.set(key, { t: now, payload })
      const outDays = (payload.days as ForecastDay[]).map((d) => {
        const irr = d.irradianceKwhM2
        const estKwh = irr ? dcKw * irr * pr : 0
        return { ...d, estKwh }
      })

      console.info(`${LOG_PREFIX} success`, {
        attempt,
        durationMs,
        days: outDays.length,
      })
      return NextResponse.json({ ...payload, days: outDays }, { status: 200 })
    } catch (e) {
      const durationMs = Date.now() - startedAt
      const message = e instanceof Error ? e.message : "Forecast failed"
      console.warn(`${LOG_PREFIX} upstream error`, {
        attempt,
        durationMs,
        aborted: ac.signal.aborted,
        message,
      })
      if (attempt < 2) {
        await wait(220)
        continue
      }
    } finally {
      clearTimeout(t)
      ac.abort()
    }
  }

  const fallbackDays = buildFallbackDays({ dcKw, pr })
  const worthIt = computeWorthIt(fallbackDays, dcKw, lossesPct)
  const fallbackPayload = {
    days: fallbackDays,
    meta: {
      source: "fallback",
      warning: "Live forecast provider is temporarily unavailable. Showing a rough fallback estimate.",
      pr,
    },
    worthIt,
  }

  console.warn(`${LOG_PREFIX} returning fallback`, {
    days: fallbackDays.length,
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
  })
  return NextResponse.json(fallbackPayload, { status: 200 })
}
