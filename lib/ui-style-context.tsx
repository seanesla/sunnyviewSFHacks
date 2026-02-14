"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { useAccent } from "@/lib/accent-context"
import { type BackgroundMode, useBackground } from "@/lib/background-context"

const UI_STYLE_STORAGE_KEY = "sunnyview-ui-style-v1"
const LEGACY_ACCENT_STORAGE_KEY = "sunnyview-accent-v1"
const LEGACY_BACKGROUND_STORAGE_KEY = "sunnyview-background-v1"

export type UiStylePresetId = "classic" | "cinematic-soft" | "refined-clean"
export type UiStyleMode = "preset" | "custom"

export interface UiStylePreset {
  id: UiStylePresetId
  label: string
  description: string
  accent: {
    hue: number
    saturation: number
  }
  background: {
    mode: BackgroundMode
    motion: number
    intensity: number
    spotlight: boolean
  }
  previewGradient: string
}

export const UI_STYLE_PRESETS: readonly UiStylePreset[] = [
  {
    id: "classic",
    label: "Classic",
    description: "Current Sunnyview look with balanced glow and motion.",
    accent: { hue: 200, saturation: 0.18 },
    background: { mode: "fusion", motion: 1, intensity: 1, spotlight: true },
    previewGradient:
      "linear-gradient(130deg, oklch(0.66 0.17 200) 0%, oklch(0.58 0.14 236) 100%)",
  },
  {
    id: "cinematic-soft",
    label: "Cinematic Soft",
    description: "Warmer highlights, richer depth, and smoother atmosphere.",
    accent: { hue: 34, saturation: 0.16 },
    background: { mode: "fusion", motion: 0.9, intensity: 1.12, spotlight: true },
    previewGradient:
      "linear-gradient(130deg, oklch(0.74 0.14 42) 0%, oklch(0.67 0.11 18) 100%)",
  },
  {
    id: "refined-clean",
    label: "Refined Clean",
    description: "Crisp neutral polish with restrained glow and calmer motion.",
    accent: { hue: 214, saturation: 0.14 },
    background: { mode: "fusion", motion: 0.82, intensity: 0.88, spotlight: false },
    previewGradient:
      "linear-gradient(130deg, oklch(0.74 0.12 224) 0%, oklch(0.8 0.06 193) 100%)",
  },
] as const

const DEFAULT_PRESET_ID: UiStylePresetId = "classic"

type StoredUiStyle = {
  presetId: UiStylePresetId
  mode: UiStyleMode
}

function coercePresetId(value: unknown): UiStylePresetId | null {
  if (value === "classic" || value === "cinematic-soft" || value === "refined-clean") {
    return value
  }
  return null
}

function coerceStyleMode(value: unknown): UiStyleMode | null {
  if (value === "preset" || value === "custom") return value
  return null
}

function getPresetById(id: UiStylePresetId): UiStylePreset {
  return UI_STYLE_PRESETS.find((preset) => preset.id === id) ?? UI_STYLE_PRESETS[0]
}

function readStoredUiStyle(): StoredUiStyle | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(UI_STYLE_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredUiStyle>
    const presetId = coercePresetId(parsed.presetId)
    const mode = coerceStyleMode(parsed.mode)
    if (!presetId || !mode) return null
    return { presetId, mode }
  } catch {
    return null
  }
}

function hasLegacyVisualSettings(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY) !== null ||
    window.localStorage.getItem(LEGACY_BACKGROUND_STORAGE_KEY) !== null
  )
}

interface UiStyleContextType {
  presetId: UiStylePresetId
  styleMode: UiStyleMode
  activePreset: UiStylePreset
  presets: readonly UiStylePreset[]
  selectPreset: (presetId: UiStylePresetId) => void
  markCustom: () => void
  resetVisualStyle: () => void
}

const UiStyleContext = createContext<UiStyleContextType>({
  presetId: DEFAULT_PRESET_ID,
  styleMode: "preset",
  activePreset: getPresetById(DEFAULT_PRESET_ID),
  presets: UI_STYLE_PRESETS,
  selectPreset: () => {},
  markCustom: () => {},
  resetVisualStyle: () => {},
})

export function UiStyleProvider({ children }: { children: ReactNode }) {
  const { setHue, setSaturation } = useAccent()
  const {
    setMode: setBackgroundMode,
    setMotion,
    setIntensity,
    setSpotlight,
  } = useBackground()
  const [presetId, setPresetId] = useState<UiStylePresetId>(DEFAULT_PRESET_ID)
  const [styleMode, setStyleMode] = useState<UiStyleMode>("preset")
  const [hydrated, setHydrated] = useState(false)
  const initializedRef = useRef(false)

  const applyPreset = useCallback(
    (nextPresetId: UiStylePresetId) => {
      const preset = getPresetById(nextPresetId)
      setHue(preset.accent.hue)
      setSaturation(preset.accent.saturation)
      setBackgroundMode(preset.background.mode)
      setMotion(preset.background.motion)
      setIntensity(preset.background.intensity)
      setSpotlight(preset.background.spotlight)
      setPresetId(nextPresetId)
      setStyleMode("preset")
    },
    [setBackgroundMode, setHue, setIntensity, setMotion, setSaturation, setSpotlight]
  )

  useEffect(() => {
    document.documentElement.dataset.uiPreset = presetId
  }, [presetId])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const stored = readStoredUiStyle()
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresetId(stored.presetId)
      setStyleMode(stored.mode)
      if (stored.mode === "preset") {
        applyPreset(stored.presetId)
      }
      setHydrated(true)
      return
    }

    if (hasLegacyVisualSettings()) {
      setPresetId(DEFAULT_PRESET_ID)
      setStyleMode("custom")
      setHydrated(true)
      return
    }

    applyPreset(DEFAULT_PRESET_ID)
    setHydrated(true)
  }, [applyPreset])

  useEffect(() => {
    if (!hydrated) return
    const stored: StoredUiStyle = { presetId, mode: styleMode }
    window.localStorage.setItem(UI_STYLE_STORAGE_KEY, JSON.stringify(stored))
  }, [hydrated, presetId, styleMode])

  const selectPreset = useCallback(
    (nextPresetId: UiStylePresetId) => {
      applyPreset(nextPresetId)
    },
    [applyPreset]
  )

  const markCustom = useCallback(() => {
    setStyleMode((prevMode) => (prevMode === "custom" ? prevMode : "custom"))
  }, [])

  const resetVisualStyle = useCallback(() => {
    applyPreset(DEFAULT_PRESET_ID)
  }, [applyPreset])

  const activePreset = getPresetById(presetId)

  return (
    <UiStyleContext.Provider
      value={{
        presetId,
        styleMode,
        activePreset,
        presets: UI_STYLE_PRESETS,
        selectPreset,
        markCustom,
        resetVisualStyle,
      }}
    >
      {children}
    </UiStyleContext.Provider>
  )
}

export function useUiStyle() {
  return useContext(UiStyleContext)
}
