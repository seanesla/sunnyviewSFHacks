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
const DRAG_VISUAL_MIN_FRAME_MS = 32

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export function AccentColorControl({ className, compact = false, showSwatch = true, onAccentChange }: AccentColorControlProps) {
  const { hue, saturation, setHue, setSaturation } = useAccent()
  const [dragDraft, setDragDraft] = useState<{ hue: number, saturation: number } | null>(null)
  const draftAccentRef = useRef({ hue, saturation })
  const draggingRef = useRef(false)
  const visualRafRef = useRef<number | null>(null)
  const lastVisualWriteRef = useRef(0)

  const displayHue = dragDraft?.hue ?? hue
  const displaySaturation = dragDraft?.saturation ?? saturation

  useEffect(() => {
    if (draggingRef.current) return
    draftAccentRef.current = { hue, saturation }
  }, [hue, saturation])

  const writeDocumentAccent = useCallback((nextHue: number, nextSaturation: number) => {
    const root = document.documentElement
    root.style.setProperty("--accent-hue", String(nextHue))
    root.style.setProperty("--accent-sat", String(nextSaturation))
  }, [])

  const commitAccent = useCallback((nextHue: number, nextSaturation: number) => {
    if (nextHue !== hue) {
      setHue(nextHue)
    }
    if (nextSaturation !== saturation) {
      setSaturation(nextSaturation)
    }
  }, [hue, saturation, setHue, setSaturation])

  const flushVisualAccentWrite = useCallback(() => {
    if (visualRafRef.current !== null) {
      window.cancelAnimationFrame(visualRafRef.current)
      visualRafRef.current = null
    }
    const next = draftAccentRef.current
    writeDocumentAccent(next.hue, next.saturation)
    lastVisualWriteRef.current = performance.now()
  }, [writeDocumentAccent])

  const scheduleVisualAccentWrite = useCallback(() => {
    if (visualRafRef.current !== null) return

    const tick = (now: number) => {
      const elapsed = now - lastVisualWriteRef.current
      if (elapsed < DRAG_VISUAL_MIN_FRAME_MS) {
        visualRafRef.current = window.requestAnimationFrame(tick)
        return
      }

      visualRafRef.current = null
      lastVisualWriteRef.current = now
      const next = draftAccentRef.current
      writeDocumentAccent(next.hue, next.saturation)
    }

    visualRafRef.current = window.requestAnimationFrame(tick)
  }, [writeDocumentAccent])

  const stopAccentDrag = useCallback(() => {
    if (!draggingRef.current) return

    draggingRef.current = false
    delete document.documentElement.dataset.accentDragging
    flushVisualAccentWrite()
    const next = draftAccentRef.current
    commitAccent(next.hue, next.saturation)
    setDragDraft(null)
  }, [commitAccent, flushVisualAccentWrite])

  const startAccentDrag = useCallback(() => {
    if (draggingRef.current) return

    const nextDraft = {
      hue,
      saturation,
    }
    draftAccentRef.current = nextDraft
    setDragDraft(nextDraft)

    draggingRef.current = true
    document.documentElement.dataset.accentDragging = "true"
  }, [hue, saturation])

  const applyDraftAccent = useCallback((nextHueRaw: number, nextSaturationRaw: number) => {
    const nextHue = normalizeHue(nextHueRaw)
    const nextSaturation = clamp(nextSaturationRaw, ACCENT_SAT_MIN, ACCENT_SAT_MAX)

    draftAccentRef.current = {
      hue: nextHue,
      saturation: nextSaturation,
    }

    onAccentChange?.()

    if (draggingRef.current) {
      setDragDraft((prev) => {
        if (prev && prev.hue === nextHue && prev.saturation === nextSaturation) {
          return prev
        }
        return { hue: nextHue, saturation: nextSaturation }
      })
      scheduleVisualAccentWrite()
      return
    }

    writeDocumentAccent(nextHue, nextSaturation)
    commitAccent(nextHue, nextSaturation)
  }, [commitAccent, onAccentChange, scheduleVisualAccentWrite, writeDocumentAccent])

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
      if (visualRafRef.current !== null) {
        window.cancelAnimationFrame(visualRafRef.current)
        visualRafRef.current = null
      }
      delete document.documentElement.dataset.accentDragging
    }
  }, [stopAccentDrag])

  const pickerColor = useMemo<HslColor>(
    () => ({ h: displayHue, s: HUE_PICKER_SATURATION, l: HUE_PICKER_LIGHTNESS }),
    [displayHue]
  )

  function handleHueChange(nextColor: HslColor) {
    applyDraftAccent(nextColor.h, draftAccentRef.current.saturation)
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
            applyDraftAccent(draftAccentRef.current.hue, Number(event.target.value))
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
