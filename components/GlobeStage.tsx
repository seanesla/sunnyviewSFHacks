"use client"

import { GlobeView } from "@/components/GlobeView"
import { cn } from "@/lib/utils"

export function GlobeStage({
  lat,
  lng,
  interactive,
  onPrimaryClick,
  onPickLocation,
  dim,
  className,
  onReadyChange,
}: {
  lat: number | null
  lng: number | null
  interactive: boolean
  onPrimaryClick?: () => void
  onPickLocation?: (p: { lat: number; lng: number }) => void
  dim?: boolean
  className?: string
  onReadyChange?: (ready: boolean) => void
}) {
  return (
    <div className={cn("absolute inset-0", className)}>
      <GlobeView
        lat={lat}
        lng={lng}
        showUi={false}
        interactive={interactive}
        onPrimaryClick={onPrimaryClick}
        onPickLocation={onPickLocation}
        frame={false}
        variant="hero"
        onReadyChange={onReadyChange}
        className="h-full w-full"
      />

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-700 ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
          dim ? "opacity-[0.85]" : "opacity-100"
        )}
      >
        <div className="earth-vignette absolute inset-0" />
      </div>
    </div>
  )
}
