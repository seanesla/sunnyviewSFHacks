"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

const ACCENT_STORAGE_KEY = "sunnyview-accent-v1"

const DEFAULT_HUE = 200
const DEFAULT_SATURATION = 0.18

export const ACCENT_SAT_MIN = 0.06
export const ACCENT_SAT_MAX = 0.28

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360
  return normalized < 0 ? normalized + 360 : normalized
}

type StoredAccent = {
  hue: number
  saturation: number
}

function readStoredAccent(): StoredAccent | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(ACCENT_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAccent>
    const hue = typeof parsed.hue === "number" ? normalizeHue(parsed.hue) : null
    const saturation = typeof parsed.saturation === "number" ? clamp(parsed.saturation, ACCENT_SAT_MIN, ACCENT_SAT_MAX) : null
    if (hue === null || saturation === null) return null
    return { hue, saturation }
  } catch {
    return null
  }
}

interface AccentContextType {
  hue: number
  saturation: number
  setHue: (hue: number) => void
  setSaturation: (saturation: number) => void
  resetAccent: () => void
}

const AccentContext = createContext<AccentContextType>({
  hue: DEFAULT_HUE,
  saturation: DEFAULT_SATURATION,
  setHue: () => {},
  setSaturation: () => {},
  resetAccent: () => {},
})

export function AccentProvider({ children }: { children: ReactNode }) {
  const [hue, setHue] = useState(DEFAULT_HUE)
  const [saturation, setSaturation] = useState(DEFAULT_SATURATION)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const storedAccent = readStoredAccent()
    if (storedAccent) {
      setHue(storedAccent.hue)
      setSaturation(storedAccent.saturation)
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-hue", String(hue))
    document.documentElement.style.setProperty("--accent-sat", String(saturation))
  }, [hue, saturation])

  useEffect(() => {
    if (!hydrated) return

    const stored: StoredAccent = { hue, saturation }
    window.localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify(stored))
    window.dispatchEvent(new CustomEvent("sunnyview:accent-change", { detail: stored }))
  }, [hue, saturation, hydrated])

  function handleSetHue(nextHue: number) {
    setHue(normalizeHue(nextHue))
  }

  function handleSetSaturation(nextSaturation: number) {
    setSaturation(clamp(nextSaturation, ACCENT_SAT_MIN, ACCENT_SAT_MAX))
  }

  function resetAccent() {
    setHue(DEFAULT_HUE)
    setSaturation(DEFAULT_SATURATION)
  }

  return (
    <AccentContext.Provider value={{ hue, saturation, setHue: handleSetHue, setSaturation: handleSetSaturation, resetAccent }}>
      {children}
    </AccentContext.Provider>
  )
}

export function useAccent() {
  return useContext(AccentContext)
}
