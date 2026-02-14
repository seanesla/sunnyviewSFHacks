"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

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
  const [hue, setHueState] = useState(DEFAULT_HUE)
  const [saturation, setSaturationState] = useState(DEFAULT_SATURATION)
  const [hydrated, setHydrated] = useState(false)
  const pendingAccentRef = useRef<StoredAccent>({
    hue: DEFAULT_HUE,
    saturation: DEFAULT_SATURATION,
  })
  const frameRef = useRef<number | null>(null)
  const persistTimeoutRef = useRef<number | null>(null)

  const applyPendingAccent = useCallback(() => {
    const pending = pendingAccentRef.current
    setHueState((prev) => (prev === pending.hue ? prev : pending.hue))
    setSaturationState((prev) =>
      prev === pending.saturation ? prev : pending.saturation
    )
  }, [])

  const scheduleApplyPendingAccent = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      applyPendingAccent()
    })
  }, [applyPendingAccent])

  useEffect(() => {
    const storedAccent = readStoredAccent()
    if (storedAccent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHueState(storedAccent.hue)
      setSaturationState(storedAccent.saturation)
      pendingAccentRef.current = storedAccent
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-hue", String(hue))
    document.documentElement.style.setProperty("--accent-sat", String(saturation))
  }, [hue, saturation])

  useEffect(() => {
    if (!hydrated) return

    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current)
      persistTimeoutRef.current = null
    }

    const stored: StoredAccent = { hue, saturation }
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null
      window.localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify(stored))
    }, 220)

    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current)
        persistTimeoutRef.current = null
      }
    }
  }, [hue, saturation, hydrated])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current)
        persistTimeoutRef.current = null
      }
    }
  }, [])

  function handleSetHue(nextHue: number) {
    pendingAccentRef.current = {
      ...pendingAccentRef.current,
      hue: normalizeHue(nextHue),
    }
    scheduleApplyPendingAccent()
  }

  function handleSetSaturation(nextSaturation: number) {
    pendingAccentRef.current = {
      ...pendingAccentRef.current,
      saturation: clamp(nextSaturation, ACCENT_SAT_MIN, ACCENT_SAT_MAX),
    }
    scheduleApplyPendingAccent()
  }

  function resetAccent() {
    pendingAccentRef.current = {
      hue: DEFAULT_HUE,
      saturation: DEFAULT_SATURATION,
    }
    scheduleApplyPendingAccent()
  }

  return (
    <AccentContext.Provider
      value={{
        hue,
        saturation,
        setHue: handleSetHue,
        setSaturation: handleSetSaturation,
        resetAccent,
      }}
    >
      {children}
    </AccentContext.Provider>
  )
}

export function useAccent() {
  return useContext(AccentContext)
}
