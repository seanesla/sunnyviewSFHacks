"use client"

import Image from "next/image"
import { useMemo, useState } from "react"

import { buildStaticMapSpec } from "@/lib/static-map"

type StaticMapPhotoProps = {
  address?: string | null
  lat: number | null
  lng: number | null
  zoom?: number | null
  className?: string
}

type StaticMapImageProps = {
  src: string
  alt: string
}

function StaticMapImage({ src, alt }: StaticMapImageProps) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  if (failed) {
    return (
      <div className="grid aspect-[13/9] place-items-center p-3 text-xs text-destructive">
        Failed to load satellite photo. Check your connection or the static-map backend route.
      </div>
    )
  }

  return (
    <div className="relative">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted/30" />}
      <Image
        src={src}
        alt={alt}
        width={1040}
        height={720}
        unoptimized
        className="block h-auto w-full"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true)
          setLoaded(false)
        }}
      />
    </div>
  )
}

export function StaticMapPhoto({ address, lat, lng, zoom, className }: StaticMapPhotoProps) {
  const src = useMemo(() => {
    if (lat === null || lng === null) return null
    return buildStaticMapSpec({ lat, lng, zoom }).src
  }, [lat, lng, zoom])

  const title = address?.trim() ? address.trim() : "Satellite preview"

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Site photo</div>
        <div className="text-[11px] text-muted-foreground">Esri World Imagery</div>
      </div>

      <div className="glass-surface mt-3 overflow-hidden rounded-lg">
        {!src ? (
          <div className="grid aspect-[13/9] place-items-center p-3 text-xs text-muted-foreground">
            Enter an address to load a satellite photo.
          </div>
        ) : (
          <StaticMapImage key={src} src={src} alt={title} />
        )}
      </div>

      {src && (
        <div className="mt-2 truncate text-[11px] text-muted-foreground" title={title}>
          {title}
        </div>
      )}
    </div>
  )
}
