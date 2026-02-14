"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const EARTH_R_M = 6378137
const ADDRESS_STATIC_MAP_SCALE = 2

export type MapInputResult = {
  kind: "address" | "image"
  address?: string
  lat: number | null
  lng: number | null
  zoom: number | null
  mPerPx: number | null
  image?: { dataUrl: string; widthPx: number; heightPx: number; fileName: string }
}

type Point = { x: number; y: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function computeMetersPerPixel(lat: number, zoom: number) {
  const latRad = (lat * Math.PI) / 180
  return (Math.cos(latRad) * 2 * Math.PI * EARTH_R_M) / (256 * Math.pow(2, zoom))
}

function formatNum(n: number | null, digits = 6) {
  if (n === null || !Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

function looksLikeFullAddress(q: string) {
  const s = q.trim()
  const hasHouse = /^\d{1,8}\s+/.test(s)
  const hasComma = s.includes(",")
  const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(s)
  const tail = s.split(",").pop() ?? ""
  const hasState = /\b[a-zA-Z]{2}\b/.test(tail)
  return hasHouse && hasComma && (hasZip || hasState)
}

function CalibrationCanvas({
  dataUrl,
  widthPx,
  heightPx,
  onMPerPx,
}: {
  dataUrl: string
  widthPx: number
  heightPx: number
  onMPerPx: (mPerPx: number | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [p1, setP1] = useState<Point | null>(null) // image coords
  const [p2, setP2] = useState<Point | null>(null) // image coords
  const [distanceValue, setDistanceValue] = useState<string>("10")
  const [unit, setUnit] = useState<"m" | "ft">("m")

  const pxDist = useMemo(() => {
    if (!p1 || !p2) return null
    return Math.hypot(p2.x - p1.x, p2.y - p1.y)
  }, [p1, p2])

  const computed = useMemo(() => {
    if (!pxDist || pxDist <= 0) return null
    const v = Number(distanceValue)
    if (!Number.isFinite(v) || v <= 0) return null
    const meters = unit === "ft" ? v * 0.3048 : v
    return meters / pxDist
  }, [pxDist, distanceValue, unit])

  useEffect(() => {
    onMPerPx(computed)
  }, [computed, onMPerPx])

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      draw()
    }
    img.src = dataUrl
    return () => {
      imgRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl])

  function draw() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const scale = Math.min(rect.width / widthPx, rect.height / heightPx)
    const drawW = widthPx * scale
    const drawH = heightPx * scale
    const offX = (rect.width - drawW) / 2
    const offY = (rect.height - drawH) / 2

    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = "rgba(0,0,0,0.35)"
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.drawImage(img, offX, offY, drawW, drawH)

    ctx.strokeStyle = "rgba(255,255,255,0.25)"
    ctx.lineWidth = 1
    ctx.strokeRect(offX, offY, drawW, drawH)

    const toCanvas = (p: Point) => ({ x: offX + p.x * scale, y: offY + p.y * scale })
    if (p1) {
      const a = toCanvas(p1)
      ctx.fillStyle = "rgba(255,255,255,0.9)"
      ctx.beginPath()
      ctx.arc(a.x, a.y, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (p2) {
      const b = toCanvas(p2)
      ctx.fillStyle = "rgba(255,255,255,0.9)"
      ctx.beginPath()
      ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2)
      ctx.fill()
    }
    if (p1 && p2) {
      const a = toCanvas(p1)
      const b = toCanvas(p2)
      ctx.strokeStyle = "rgba(255,255,255,0.9)"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()

      ctx.fillStyle = "rgba(0,0,0,0.6)"
      ctx.fillRect(Math.min(a.x, b.x) + 6, Math.min(a.y, b.y) + 6, 140, 24)
      ctx.fillStyle = "rgba(255,255,255,0.9)"
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
      ctx.fillText(`${Math.round(pxDist ?? 0)} px`, Math.min(a.x, b.x) + 14, Math.min(a.y, b.y) + 22)
    }
  }

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1, p2, pxDist, distanceValue, unit, widthPx, heightPx])

  function canvasToImage(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const scale = Math.min(rect.width / widthPx, rect.height / heightPx)
    const drawW = widthPx * scale
    const drawH = heightPx * scale
    const offX = (rect.width - drawW) / 2
    const offY = (rect.height - drawH) / 2

    const ix = (x - offX) / scale
    const iy = (y - offY) / scale
    if (ix < 0 || iy < 0 || ix > widthPx || iy > heightPx) return null
    return { x: ix, y: iy }
  }

  return (
    <div className="glass-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-card-foreground">Calibrate scale</div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            setP1(null)
            setP2(null)
          }}
        >
          Clear line
        </button>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="h-[220px] w-full cursor-crosshair rounded-md border border-border bg-muted/20"
            onClick={(e) => {
              const p = canvasToImage(e)
              if (!p) return
              if (!p1 || (p1 && p2)) {
                setP1(p)
                setP2(null)
                return
              }
              setP2(p)
            }}
          />
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-background/75 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
            Click two points along a known distance
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            {pxDist ? `Line length: ${pxDist.toFixed(1)} px` : "Draw a line to compute meters-per-pixel."}
          </div>
          <div className="flex gap-2">
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={distanceValue}
              inputMode="decimal"
              onChange={(e) => setDistanceValue(e.target.value)}
              placeholder="Distance"
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              value={unit}
              onChange={(e) => setUnit(e.target.value as "m" | "ft")}
            >
              <option value="m">m</option>
              <option value="ft">ft</option>
            </select>
          </div>
          <div className="glass-surface rounded-md px-3 py-2 text-xs text-muted-foreground">
            <div>
              m/px: <span className="text-foreground">{computed ? computed.toExponential(3) : "—"}</span>
            </div>
            <div className="mt-1">
              Tip: Use a driveway width, property line, or a known rooftop feature.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MapInput({
  value,
  onChange,
}: {
  value: MapInputResult
  onChange: (next: MapInputResult) => void
}) {
  const COLLAPSED_SUGGESTIONS = 8

  type GeoOption = {
    id: string
    displayName: string
    lat: number | null
    lng: number | null
    magicKey: string | null
    score: number | null
  }

  const [tab, setTab] = useState<"address" | "image">(value.kind)
  const [address, setAddress] = useState<string>(value.address ?? "")
  const [zoom, setZoom] = useState<number>(value.zoom ?? 19)
  const [foundLat, setFoundLat] = useState<number | null>(value.lat)
  const [foundLng, setFoundLng] = useState<number | null>(value.lng)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [geoWarning, setGeoWarning] = useState<string | null>(null)
  const [geoOptions, setGeoOptions] = useState<GeoOption[]>([])
  const geoAbortRef = useRef<AbortController | null>(null)
  const suggestAbortRef = useRef<AbortController | null>(null)
  const [biasLat, setBiasLat] = useState<number | null>(null)
  const [biasLng, setBiasLng] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lastCenterRef = useRef<{ lat: number; lng: number } | null>(
    value.lat !== null && value.lng !== null ? { lat: value.lat, lng: value.lng } : null
  )

  const canSearch = useMemo(() => {
    const q = address.trim()
    if (!q) return false
    return selectedId !== null || looksLikeFullAddress(q)
  }, [address, selectedId])

  const resolveMagicKey = useCallback(
    async (text: string, magicKey: string) => {
      const url = new URL("/api/geocode", window.location.origin)
      url.searchParams.set("mode", "resolve")
      url.searchParams.set("q", text)
      url.searchParams.set("magicKey", magicKey)
      url.searchParams.set("limit", "1")
      const res = await fetch(url.toString(), { headers: { accept: "application/json" } })
      if (!res.ok) throw new Error(`Geocoder error (${res.status})`)
      const data = (await res.json().catch(() => null)) as any
      const hit = Array.isArray(data?.results) ? data.results[0] : null
      const id = typeof hit?.id === "string" ? hit.id : null
      const displayName = typeof hit?.displayName === "string" ? hit.displayName : null
      const lat = Number(hit?.lat)
      const lng = Number(hit?.lng)
      if (!id || !displayName || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("No results. Try a more specific address.")
      }
      return { id, displayName, lat, lng }
    },
    []
  )

  const chooseOption = useCallback(
    async (opt: GeoOption) => {
      setGeoError(null)
      setGeoWarning(null)
      setExpanded(false)

      if (opt.lat !== null && opt.lng !== null) {
        setSelectedId(opt.id)
        setFoundLat(opt.lat)
        setFoundLng(opt.lng)
        setAddress(opt.displayName)
        lastCenterRef.current = { lat: opt.lat, lng: opt.lng }
        return
      }

      if (!opt.magicKey) {
        setGeoError("Pick a different suggestion or type a full address.")
        return
      }

      setGeoBusy(true)
      try {
        const resolved = await resolveMagicKey(opt.displayName, opt.magicKey)
        setSelectedId(resolved.id)
        setFoundLat(resolved.lat)
        setFoundLng(resolved.lng)
        setAddress(resolved.displayName)
        lastCenterRef.current = { lat: resolved.lat, lng: resolved.lng }
      } catch (e) {
        setGeoError(e instanceof Error ? e.message : "Address lookup failed.")
      } finally {
        setGeoBusy(false)
      }
    },
    [resolveMagicKey]
  )

  const runSearch = useCallback(async () => {
    const q = address.trim()
    if (!q) return
    if (foundLat !== null && foundLng !== null) return

    if (!looksLikeFullAddress(q)) {
      setGeoError("Pick a suggestion (required) or type a full address including city/state.")
      return
    }

    setGeoBusy(true)
    setGeoError(null)
    setGeoWarning(null)
    geoAbortRef.current?.abort()
    const ac = new AbortController()
    geoAbortRef.current = ac
    try {
      const url = new URL("/api/geocode", window.location.origin)
      url.searchParams.set("mode", "lookup")
      url.searchParams.set("q", q)
      url.searchParams.set("limit", "15")
      const bias = biasLat !== null && biasLng !== null ? { lat: biasLat, lng: biasLng } : lastCenterRef.current
      if (bias) {
        url.searchParams.set("biasLat", String(bias.lat))
        url.searchParams.set("biasLng", String(bias.lng))
      }

      const res = await fetch(url.toString(), { signal: ac.signal, headers: { accept: "application/json" } })
      if (!res.ok) throw new Error(`Geocoder error (${res.status})`)
      const data = (await res.json().catch(() => null)) as any
      const results = Array.isArray(data?.results) ? data.results : []
      const warning = typeof data?.warning === "string" ? data.warning : null

      const options: GeoOption[] = results
        .map((r: any) => {
          const id = typeof r?.id === "string" ? r.id : null
          const displayName = typeof r?.displayName === "string" ? r.displayName : null
          const latN = Number(r?.lat)
          const lngN = Number(r?.lng)
          const scoreN = Number(r?.score)
          const lat = Number.isFinite(latN) ? latN : null
          const lng = Number.isFinite(lngN) ? lngN : null
          const score = Number.isFinite(scoreN) ? scoreN : null
          if (!id || !displayName || lat === null || lng === null) return null
          return { id, displayName, lat, lng, magicKey: null, score }
        })
        .filter(Boolean)

      if (!options.length) {
        setGeoError("No results. Try a more specific address.")
        return
      }

      setGeoOptions(options)
      setGeoWarning(warning)

      await chooseOption(options[0])
      if (!Number.isFinite(zoom)) setZoom(19)
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "Address lookup failed.")
    } finally {
      setGeoBusy(false)
    }
  }, [address, biasLat, biasLng, chooseOption, foundLat, foundLng, zoom])

  useEffect(() => {
    if (tab !== "address") return
    const q = address.trim()
    setGeoWarning(null)
    setExpanded(false)
    if (q.length < 3) {
      setGeoOptions([])
      setSuggestBusy(false)
      suggestAbortRef.current?.abort()
      return
    }

    suggestAbortRef.current?.abort()
    const ac = new AbortController()
    suggestAbortRef.current = ac
    setSuggestBusy(true)

    const t = window.setTimeout(async () => {
      try {
        const url = new URL("/api/geocode", window.location.origin)
        url.searchParams.set("mode", "suggest")
        url.searchParams.set("q", q)
        url.searchParams.set("limit", "15")
        const bias = biasLat !== null && biasLng !== null ? { lat: biasLat, lng: biasLng } : lastCenterRef.current
        if (bias) {
          url.searchParams.set("biasLat", String(bias.lat))
          url.searchParams.set("biasLng", String(bias.lng))
        }
        const res = await fetch(url.toString(), { signal: ac.signal, headers: { accept: "application/json" } })
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as any
        const results = Array.isArray(data?.results) ? data.results : []
        const options: GeoOption[] = results
          .map((r: any) => {
            const id = typeof r?.id === "string" ? r.id : null
            const displayName = typeof r?.displayName === "string" ? r.displayName : null
            const magicKey = typeof r?.magicKey === "string" ? r.magicKey : null
            if (!id || !displayName || !magicKey) return null
            return { id, displayName, lat: null, lng: null, magicKey, score: null }
          })
          .filter(Boolean)
        setGeoOptions(options)
        const warning = typeof data?.warning === "string" ? data.warning : null
        setGeoWarning(warning)
      } catch {
        // ignore suggestion failures
      } finally {
        setSuggestBusy(false)
      }
    }, 260)

    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [address, tab, biasLat, biasLng])

  const computedMPerPx = useMemo(() => {
    if (tab !== "address") return null
    if (foundLat === null || !Number.isFinite(foundLat)) return null
    if (!Number.isFinite(zoom)) return null
    const effectiveZoom = Math.round(zoom)
    return computeMetersPerPixel(foundLat, effectiveZoom) / ADDRESS_STATIC_MAP_SCALE
  }, [tab, foundLat, zoom])

  useEffect(() => {
    if (tab !== "address") return
    onChange({
      kind: "address",
      address,
      lat: foundLat,
      lng: foundLng,
      zoom: Number.isFinite(zoom) ? Math.round(zoom) : null,
      mPerPx: foundLat !== null && foundLng !== null ? computedMPerPx : null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, address, foundLat, foundLng, zoom, computedMPerPx])

  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageData, setImageData] = useState<MapInputResult["image"]>(value.image)
  const [imageMPerPx, setImageMPerPx] = useState<number | null>(value.mPerPx ?? null)

  useEffect(() => {
    if (tab !== "image") return
    onChange({
      kind: "image",
      lat: value.lat ?? null,
      lng: value.lng ?? null,
      zoom: null,
      mPerPx: imageMPerPx,
      image: imageData,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, imageData, imageMPerPx])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("address")}
          className={`rounded-md px-3 py-1.5 text-sm ${
            tab === "address" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
          }`}
        >
          Address
        </button>
        <button
          type="button"
          onClick={() => setTab("image")}
          className={`rounded-md px-3 py-1.5 text-sm ${
            tab === "image" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
          }`}
        >
          Screenshot upload
        </button>
      </div>

      {tab === "address" && (
        <div className="glass-card p-3">
          <div className="text-sm font-medium text-card-foreground">Find a house by address</div>
          <div className="mt-2 flex gap-2">
            <div className="relative w-full">
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                placeholder="1600 Amphitheatre Parkway, Mountain View, CA"
              value={address}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                e.preventDefault()
                if (!canSearch) {
                  setGeoError("Pick a suggestion (required) or type a full address including city/state.")
                  return
                }
                void runSearch()
              }}
              onChange={(e) => {
                const next = e.target.value
                setAddress(next)
                setSelectedId(null)
                setFoundLat(null)
                setFoundLng(null)
                setGeoError(null)
              }}
            />

              {focused && address.trim().length >= 3 && (suggestBusy || geoOptions.length > 0) && selectedId === null && (
                <div
                  className="glass-surface absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-md shadow-lg"
                  onMouseDown={(e) => {
                    // Prevent input blur before click selection.
                    e.preventDefault()
                  }}
                >
                  {suggestBusy && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                  )}
                  {!suggestBusy && geoOptions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No matches yet. Try adding city/state.</div>
                  )}
                  {!suggestBusy && geoOptions.length > 0 && (
                    <div className="max-h-72 overflow-auto py-1">
                      {geoOptions.slice(0, expanded ? 15 : COLLAPSED_SUGGESTIONS).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-xs text-foreground hover:bg-secondary/50"
                          onClick={() => void chooseOption(c)}
                        >
                          {c.displayName}
                        </button>
                      ))}
                      {geoOptions.length > COLLAPSED_SUGGESTIONS && (
                        <div className="border-t border-border/60 p-1">
                          <button
                            type="button"
                            className="w-full rounded-md px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-secondary/40"
                            onClick={() => setExpanded((v) => !v)}
                          >
                            {expanded
                              ? `Show fewer results`
                              : `Show more (${Math.min(15, geoOptions.length)} total)`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="h-10 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={geoBusy || !address.trim() || !canSearch}
              onClick={() => void runSearch()}
            >
              {geoBusy ? "Searching…" : selectedId ? "Use" : "Search"}
            </button>
          </div>
          {geoError && <div className="mt-2 text-xs text-destructive">{geoError}</div>}
          {geoWarning && !geoError && <div className="mt-2 text-xs text-muted-foreground">{geoWarning}</div>}
          <div className="mt-2 text-[11px] text-muted-foreground">
            Autocomplete is required unless you type a full address with city/state (or ZIP).
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="glass-surface rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-background/60"
              onClick={async () => {
                if (!navigator?.geolocation) {
                  setGeoError("Geolocation not supported in this browser.")
                  return
                }
                setGeoError(null)
                try {
                  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000 })
                  })
                  setBiasLat(pos.coords.latitude)
                  setBiasLng(pos.coords.longitude)
                } catch {
                  setGeoError("Could not access your location (permission denied or timed out).")
                }
              }}
            >
              Use my location to improve matches
            </button>
            {biasLat !== null && biasLng !== null && (
              <div className="text-[11px] text-muted-foreground">
                Bias on: <span className="text-foreground">{formatNum(biasLat, 3)}</span>,{" "}
                <span className="text-foreground">{formatNum(biasLng, 3)}</span>
              </div>
            )}
          </div>

          {geoOptions.length > 0 && selectedId === null && !focused && (
            <div className="glass-surface mt-3 rounded-md p-2">
              <div className="text-[11px] font-medium text-muted-foreground">Pick a suggestion</div>
              <div className="mt-2 grid gap-1">
                {geoOptions.slice(0, expanded ? 15 : COLLAPSED_SUGGESTIONS).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="rounded-md px-2 py-1 text-left text-xs text-foreground hover:bg-secondary/50"
                    onClick={() => void chooseOption(c)}
                  >
                    {c.displayName}
                  </button>
                ))}
                {geoOptions.length > COLLAPSED_SUGGESTIONS && (
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-secondary/40"
                    onClick={() => setExpanded((v) => !v)}
                  >
                    {expanded ? "Show fewer" : `Show more (${Math.min(15, geoOptions.length)} total)`}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="glass-surface rounded-md px-3 py-2 text-xs text-muted-foreground">
              <div>
                lat: <span className="text-foreground">{formatNum(foundLat, 6)}</span>
              </div>
              <div className="mt-1">
                lng: <span className="text-foreground">{formatNum(foundLng, 6)}</span>
              </div>
              <div className="mt-1">
                zoom:{" "}
                <span className="text-foreground">{Number.isFinite(zoom) ? zoom.toFixed(1) : "—"}</span>
              </div>
              <div className="mt-1">
                m/px:{" "}
                <span className="text-foreground">{computedMPerPx ? computedMPerPx.toExponential(3) : "—"}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-muted-foreground">Zoom (OSM background uses integer zoom)</label>
              <input
                type="range"
                min={14}
                max={21}
                step={1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-muted-foreground">
                Adjust zoom to approximate scale if you’re packing panels without a calibrated screenshot.
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "image" && (
        <div className="space-y-3">
          <div className="glass-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-card-foreground">Upload a satellite screenshot</div>
              <div className="text-xs text-muted-foreground">PNG/JPG</div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setImageBusy(true)
                  setImageError(null)
                  const reader = new FileReader()
                  reader.onload = () => {
                    const dataUrl = String(reader.result ?? "")
                    const img = new Image()
                    img.onload = () => {
                      setImageData({
                        dataUrl,
                        widthPx: img.naturalWidth,
                        heightPx: img.naturalHeight,
                        fileName: file.name,
                      })
                      setImageBusy(false)
                    }
                    img.onerror = () => {
                      setImageError("Couldn’t read that image.")
                      setImageBusy(false)
                    }
                    img.src = dataUrl
                  }
                  reader.onerror = () => {
                    setImageError("Upload failed.")
                    setImageBusy(false)
                  }
                  reader.readAsDataURL(file)
                }}
              />
              {imageBusy && <div className="text-xs text-muted-foreground">Loading…</div>}
              {imageError && <div className="text-xs text-destructive">{imageError}</div>}
            </div>
          </div>

          {imageData && (
            <CalibrationCanvas
              dataUrl={imageData.dataUrl}
              widthPx={imageData.widthPx}
              heightPx={imageData.heightPx}
              onMPerPx={(m) => setImageMPerPx(m)}
            />
          )}
        </div>
      )}
    </div>
  )
}
