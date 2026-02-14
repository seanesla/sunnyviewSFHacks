"use client"

import { useMemo } from "react"
import { HslColorPicker, type HslColor } from "react-colorful"
import { ACCENT_SAT_MAX, ACCENT_SAT_MIN, useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"

interface AccentColorControlProps {
  className?: string
  compact?: boolean
  showSwatch?: boolean
  onAccentChange?: () => void
}

const HUE_PICKER_SATURATION = 100
const HUE_PICKER_LIGHTNESS = 50

export function AccentColorControl({ className, compact = false, showSwatch = true, onAccentChange }: AccentColorControlProps) {
  const { hue, saturation, setHue, setSaturation } = useAccent()

  const pickerColor = useMemo<HslColor>(
    () => ({ h: hue, s: HUE_PICKER_SATURATION, l: HUE_PICKER_LIGHTNESS }),
    [hue]
  )

  function handleHueChange(nextColor: HslColor) {
    setHue(nextColor.h)
    onAccentChange?.()
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <div className={cn("flex items-center justify-between gap-2 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
          <span>Hue</span>
          <span className="text-foreground">{Math.round(hue)} deg</span>
        </div>
        <HslColorPicker
          color={pickerColor}
          onChange={handleHueChange}
          className={cn("accent-hue-picker", compact && "accent-hue-picker--compact")}
        />
      </div>

      <label className="block space-y-1.5">
        <div className={cn("flex items-center justify-between gap-2 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
          <span>Intensity</span>
          <span className="text-foreground">{Math.round(saturation * 100)}%</span>
        </div>
        <input
          type="range"
          min={ACCENT_SAT_MIN}
          max={ACCENT_SAT_MAX}
          step={0.01}
          value={saturation}
          onChange={(event) => {
            setSaturation(Number(event.target.value))
            onAccentChange?.()
          }}
          className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
          style={{
            background: `linear-gradient(to right, oklch(0.74 ${ACCENT_SAT_MIN} ${hue}), oklch(0.74 ${ACCENT_SAT_MAX} ${hue}))`,
          }}
        />
      </label>

      {showSwatch ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/35 px-2.5 py-2">
          <div
            className="h-4 w-4 rounded-full border border-foreground/20"
            style={{ background: `oklch(0.72 ${saturation} ${hue})` }}
          />
          <span className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>Live accent preview</span>
        </div>
      ) : null}
    </div>
  )
}
