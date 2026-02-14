"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function hueDistance(a: number, b: number): number {
  return Math.abs(((normalizeHue(b) - normalizeHue(a) + 540) % 360) - 180)
}

export function AccentColorControl({ className, compact = false, showSwatch = true, onAccentChange }: AccentColorControlProps) {
  const { hue, saturation, setHue, setSaturation } = useAccent()
  const [dragDraft, setDragDraft] = useState<{ hue: number, saturation: number } | null>(null)
  const draggingRef = useRef(false)

  const displayHue = dragDraft?.hue ?? hue
  const displaySaturation = dragDraft?.saturation ?? saturation

  const stopAccentDrag = useCallback(() => {
    if (!draggingRef.current) return

    draggingRef.current = false
    delete document.documentElement.dataset.accentDragging
  }, [])

  const startAccentDrag = useCallback(() => {
    if (draggingRef.current) return

    const nextDraft = {
      hue,
      saturation,
    }
    setDragDraft(nextDraft)

    draggingRef.current = true
    document.documentElement.dataset.accentDragging = "true"
  }, [hue, saturation])

  const applyDraftAccent = useCallback((nextHueRaw: number, nextSaturationRaw: number) => {
    const nextHue = normalizeHue(nextHueRaw)
    const nextSaturation = clamp(nextSaturationRaw, ACCENT_SAT_MIN, ACCENT_SAT_MAX)

    onAccentChange?.()

    if (draggingRef.current) {
      setDragDraft((prev) => {
        if (prev && prev.hue === nextHue && prev.saturation === nextSaturation) {
          return prev
        }
        return { hue: nextHue, saturation: nextSaturation }
      })
    }

    if (nextHue !== hue) {
      setHue(nextHue)
    }
    if (nextSaturation !== saturation) {
      setSaturation(nextSaturation)
    }
  }, [hue, onAccentChange, saturation, setHue, setSaturation])

  useEffect(() => {
    if (draggingRef.current) return
    if (!dragDraft) return

    const hueDelta = hueDistance(hue, dragDraft.hue)
    const saturationDelta = Math.abs(saturation - dragDraft.saturation)
    if (hueDelta <= 0.35 && saturationDelta <= 0.0025) {
      const clearDraftFrame = window.requestAnimationFrame(() => {
        setDragDraft(null)
      })

      return () => {
        window.cancelAnimationFrame(clearDraftFrame)
      }
    }
  }, [dragDraft, hue, saturation])

  useEffect(() => {
    const handlePointerEnd = () => {
      stopAccentDrag()
    }

    window.addEventListener("pointerup", handlePointerEnd)
    window.addEventListener("pointercancel", handlePointerEnd)
    window.addEventListener("blur", handlePointerEnd)

    return () => {
      window.removeEventListener("pointerup", handlePointerEnd)
      window.removeEventListener("pointercancel", handlePointerEnd)
      window.removeEventListener("blur", handlePointerEnd)
      stopAccentDrag()
      delete document.documentElement.dataset.accentDragging
    }
  }, [stopAccentDrag])

  const pickerColor = useMemo<HslColor>(
    () => ({ h: displayHue, s: HUE_PICKER_SATURATION, l: HUE_PICKER_LIGHTNESS }),
    [displayHue]
  )

  function handleHueChange(nextColor: HslColor) {
    applyDraftAccent(nextColor.h, displaySaturation)
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <div className={cn("flex items-center justify-between gap-2 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
          <span>Hue</span>
          <span className="text-foreground">{Math.round(displayHue)} deg</span>
        </div>
        <div onPointerDownCapture={startAccentDrag}>
          <HslColorPicker
            color={pickerColor}
            onChange={handleHueChange}
            className={cn("accent-hue-picker", compact && "accent-hue-picker--compact")}
          />
        </div>
      </div>

      <label className="block space-y-1.5">
        <div className={cn("flex items-center justify-between gap-2 text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>
          <span>Intensity</span>
          <span className="text-foreground">{Math.round(displaySaturation * 100)}%</span>
        </div>
        <input
          type="range"
          min={ACCENT_SAT_MIN}
          max={ACCENT_SAT_MAX}
          step={0.01}
          value={displaySaturation}
          onPointerDown={startAccentDrag}
          onChange={(event) => {
            applyDraftAccent(displayHue, Number(event.target.value))
          }}
          className="hue-slider h-3 w-full cursor-pointer appearance-none rounded-full outline-none"
          style={{
            background: `linear-gradient(to right, oklch(0.74 ${ACCENT_SAT_MIN} ${displayHue}), oklch(0.74 ${ACCENT_SAT_MAX} ${displayHue}))`,
          }}
        />
      </label>

      {showSwatch ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/35 px-2.5 py-2">
          <div
            className="h-4 w-4 rounded-full border border-foreground/20"
            style={{ background: `oklch(0.72 ${displaySaturation} ${displayHue})` }}
          />
          <span className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>Live accent preview</span>
        </div>
      ) : null}
    </div>
  )
}
