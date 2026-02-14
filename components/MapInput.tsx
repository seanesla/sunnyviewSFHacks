"use client"

import { useEffect, useMemo, useRef, useState } from "react"

const EARTH_R_M = 6378137

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
    <div className="rounded-lg border border-border bg-card p-3">
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
          <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
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
  const [tab, setTab] = useState<"address" | "image">(value.kind)
  const [address, setAddress] = useState<string>(value.address ?? "")
  const [zoom, setZoom] = useState<number>(value.zoom ?? 19)
  const [foundLat, setFoundLat] = useState<number | null>(value.lat)
  const [foundLng, setFoundLng] = useState<number | null>(value.lng)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const geoAbortRef = useRef<AbortController | null>(null)

  const computedMPerPx = useMemo(() => {
    if (tab !== "address") return null
    if (foundLat === null || !Number.isFinite(foundLat)) return null
    if (!Number.isFinite(zoom)) return null
    return computeMetersPerPixel(foundLat, zoom)
  }, [tab, foundLat, zoom])

  useEffect(() => {
    if (tab !== "address") return
    onChange({
      kind: "address",
      address,
      lat: foundLat,
      lng: foundLng,
      zoom,
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
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-sm font-medium text-card-foreground">Find a house by address</div>
          <div className="mt-2 flex gap-2">
            <input
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              placeholder="1600 Amphitheatre Parkway, Mountain View, CA"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            <button
              type="button"
              className="h-10 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={geoBusy || !address.trim()}
              onClick={async () => {
                const q = address.trim()
                if (!q) return
                setGeoBusy(true)
                setGeoError(null)
                geoAbortRef.current?.abort()
                const ac = new AbortController()
                geoAbortRef.current = ac
                try {
                  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`
                  const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } })
                  if (!res.ok) throw new Error(`Geocoder error (${res.status})`)
                  const data = (await res.json().catch(() => null)) as any
                  const hit = Array.isArray(data) ? data[0] : null
                  const latN = hit ? Number(hit.lat) : NaN
                  const lngN = hit ? Number(hit.lon) : NaN
                  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
                    setGeoError("No results. Try a more specific address.")
                    return
                  }
                  setFoundLat(latN)
                  setFoundLng(lngN)
                  if (!Number.isFinite(zoom)) setZoom(19)
                } catch (e) {
                  setGeoError(e instanceof Error ? e.message : "Address lookup failed.")
                } finally {
                  setGeoBusy(false)
                }
              }}
            >
              {geoBusy ? "Searching…" : "Search"}
            </button>
          </div>
          {geoError && <div className="mt-2 text-xs text-destructive">{geoError}</div>}
          <div className="mt-2 text-[11px] text-muted-foreground">
            Geocoding uses OpenStreetMap Nominatim directly from the browser (demo-friendly; for production, proxy it).
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
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
                step={0.1}
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
          <div className="rounded-lg border border-border bg-card p-3">
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
