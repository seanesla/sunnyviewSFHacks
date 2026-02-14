"use client"

import { useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type Day = {
  date: string
  estKwh: number
  irradianceKwhM2: number | null
  cloudCoverPct: number | null
}

type ForecastPayload = {
  days: Day[]
  meta?: {
    source?: string
    warning?: string
  } | null
  worthIt?: {
    verdict?: "good" | "maybe" | "unlikely"
    paybackYears?: number | null
    annualKwhEst?: number
    annualSavingsUsd?: number
    installCostUsd?: number
    reasons?: string[]
  }
}

function verdictLabel(v: string | undefined) {
  if (v === "good") return { text: "Worth it", cls: "bg-emerald-500/15 text-emerald-200" }
  if (v === "maybe") return { text: "Maybe", cls: "bg-amber-500/15 text-amber-200" }
  if (v === "unlikely") return { text: "Unlikely", cls: "bg-rose-500/15 text-rose-200" }
  return { text: "—", cls: "bg-muted/30 text-muted-foreground" }
}

export function SolarForecastCard({
  lat,
  lng,
  dcKw,
  lossesPct,
  panelCount,
  className,
}: {
  lat: number | null
  lng: number | null
  dcKw: number
  lossesPct: number
  panelCount: number
  className?: string
}) {
  const [payload, setPayload] = useState<ForecastPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lat === null || lng === null) return
    if (!Number.isFinite(dcKw) || dcKw <= 0 || panelCount <= 0) {
      setPayload(null)
      setError(null)
      return
    }

    const ac = new AbortController()
    setLoading(true)
    setError(null)

    console.info("[forecast] client request", {
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      dcKw: Number(dcKw.toFixed(3)),
      lossesPct,
      panelCount,
    })

    const url = new URL("/api/forecast", window.location.origin)
    url.searchParams.set("lat", String(lat))
    url.searchParams.set("lng", String(lng))
    url.searchParams.set("dcKw", String(dcKw))
    url.searchParams.set("lossesPct", String(lossesPct))

    ;(async () => {
      try {
        const res = await fetch(url.toString(), { signal: ac.signal, headers: { accept: "application/json" } })
        const data = (await res.json().catch(() => null)) as any
        if (!res.ok) throw new Error(String(data?.error ?? `Forecast failed (${res.status})`))
        const days = Array.isArray(data?.days) ? data.days : []
        setPayload({ days, meta: data?.meta ?? null, worthIt: data?.worthIt ?? null })
        console.info("[forecast] client success", {
          days: days.length,
          source: typeof data?.meta?.source === "string" ? data.meta.source : "unknown",
        })
      } catch (e) {
        if (ac.signal.aborted) return
        const message = e instanceof Error ? e.message : "Forecast failed"
        console.error("[forecast] client error", { message })
        if (/fetch failed|network|timeout|failed to fetch/i.test(message)) {
          setError("Forecast service is temporarily unavailable. Please try again shortly.")
        } else {
          setError(message)
        }
        setPayload(null)
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()

    return () => ac.abort()
  }, [dcKw, lat, lng, lossesPct, panelCount])

  const days = useMemo(() => payload?.days ?? [], [payload])
  const sum7 = useMemo(() => days.reduce((s, d) => s + (Number(d?.estKwh) || 0), 0), [days])
  const avgDaily = days.length ? sum7 / days.length : 0
  const warning = typeof payload?.meta?.warning === "string" ? payload.meta.warning : null
  const worth = payload?.worthIt ?? null
  const badge = verdictLabel(worth?.verdict)

  const chartData = useMemo(
    () =>
      days.map((d) => ({
        day: d.date.slice(5),
        kwh: Math.max(0, Number(d.estKwh) || 0),
        cloud: d.cloudCoverPct,
      })),
    [days]
  )

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">7-day production forecast</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Uses Open-Meteo radiation + your current layout (rough).
          </div>
          {warning ? <div className="mt-1 text-[11px] text-amber-300">{warning}</div> : null}
        </div>
        <div className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.cls}`}>{badge.text}</div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="glass-surface rounded-lg p-3">
          <div className="text-[11px] text-muted-foreground">Next 7 days</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{sum7.toFixed(1)} kWh</div>
        </div>
        <div className="glass-surface rounded-lg p-3">
          <div className="text-[11px] text-muted-foreground">Avg / day</div>
          <div className="mt-1 text-lg font-semibold text-foreground">{avgDaily.toFixed(1)} kWh</div>
        </div>
        <div className="glass-surface rounded-lg p-3">
          <div className="text-[11px] text-muted-foreground">Payback (rough)</div>
          <div className="mt-1 text-lg font-semibold text-foreground">
            {worth?.paybackYears ? `${worth.paybackYears.toFixed(1)}y` : "—"}
          </div>
        </div>
      </div>

      <div className="glass-surface mt-3 rounded-lg p-3">
        {loading ? (
          <div className="text-xs text-muted-foreground">Loading forecast…</div>
        ) : error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : chartData.length ? (
          <div className="h-[190px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="kwhFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(245, 158, 11)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="rgb(245, 158, 11)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} width={34} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(0,0,0,0.75)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.85)" }}
                  formatter={(value: any, name: any, item: any) => {
                    if (name === "kwh") {
                      const cloud = item?.payload?.cloud
                      return [`${Number(value).toFixed(1)} kWh${Number.isFinite(cloud) ? ` (cloud ${Math.round(cloud)}%)` : ""}`, "Est."]
                    }
                    return [String(value), String(name)]
                  }}
                />
                <Area type="monotone" dataKey="kwh" stroke="rgba(245, 158, 11, 0.85)" strokeWidth={2} fill="url(#kwhFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Add a roof outline to see a forecast.</div>
        )}
      </div>

      {worth?.reasons?.length ? (
        <div className="mt-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Why</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {worth.reasons.slice(0, 3).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
