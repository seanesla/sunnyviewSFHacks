"use client"

import { useEffect, useMemo, useState } from "react"

type StaticMapPhotoProps = {
  address?: string | null
  lat: number | null
  lng: number | null
  zoom?: number | null
  className?: string
}

export function StaticMapPhoto({ address, lat, lng, zoom, className }: StaticMapPhotoProps) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const src = useMemo(() => {
    if (lat === null || lng === null) return null
    const z = zoom ?? 19
    const qs = new URLSearchParams()
    qs.set("lat", String(lat))
    qs.set("lng", String(lng))
    qs.set("zoom", String(z))
    qs.set("w", "520")
    qs.set("h", "360")
    qs.set("scale", "2")
    qs.set("style", "mapbox/satellite-streets-v12")
    return `/api/static-map?${qs.toString()}`
  }, [lat, lng, zoom])

  const title = address?.trim() ? address.trim() : "Satellite preview"

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Site photo</div>
        <div className="text-[11px] text-muted-foreground">Esri World Imagery</div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background/40">
        {!src ? (
          <div className="grid aspect-[13/9] place-items-center p-3 text-xs text-muted-foreground">
            Enter an address to load a satellite photo.
          </div>
        ) : failed ? (
          <div className="grid aspect-[13/9] place-items-center p-3 text-xs text-destructive">
            Failed to load photo. Check your Mapbox token and try again.
          </div>
        ) : (
          <div className="relative">
            {!loaded && <div className="absolute inset-0 animate-pulse bg-muted/30" />}
            <img
              src={src}
              alt={title}
              className="block h-auto w-full"
              onLoad={() => setLoaded(true)}
              onError={() => {
                setFailed(true)
                setLoaded(false)
              }}
            />
          </div>
        )}
      </div>

      {src && !failed && (
        <div className="mt-2 truncate text-[11px] text-muted-foreground" title={title}>
          {title}
        </div>
      )}
    </div>
  )
}
