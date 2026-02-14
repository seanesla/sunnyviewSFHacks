"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

const BACKGROUND_STORAGE_KEY = "sunnyview-background-v1"

export type BackgroundMode = "fusion" | "grid"

const DEFAULT_MODE: BackgroundMode = "fusion"
const DEFAULT_MOTION = 1
const DEFAULT_INTENSITY = 1
const DEFAULT_SPOTLIGHT = true

const MOTION_MIN = 0.6
const MOTION_MAX = 1.5
const INTENSITY_MIN = 0.65
const INTENSITY_MAX = 1.35

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function coerceMode(mode: unknown): BackgroundMode | null {
  if (mode === "grid") {
    return "grid"
  }
  if (mode === "fusion" || mode === "prism" || mode === "aurora") {
    return "fusion"
  }
  return null
}

type StoredBackground = {
  mode: BackgroundMode
  motion: number
  intensity: number
  spotlight: boolean
}

function readStoredBackground(): StoredBackground | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(BACKGROUND_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredBackground>
    const mode = coerceMode(parsed.mode)
    const motion = typeof parsed.motion === "number" ? clamp(parsed.motion, MOTION_MIN, MOTION_MAX) : null
    const intensity = typeof parsed.intensity === "number" ? clamp(parsed.intensity, INTENSITY_MIN, INTENSITY_MAX) : null
    const spotlight = typeof parsed.spotlight === "boolean" ? parsed.spotlight : null
    if (!mode || motion === null || intensity === null || spotlight === null) return null
    return { mode, motion, intensity, spotlight }
  } catch {
    return null
  }
}

interface BackgroundContextType {
  mode: BackgroundMode
  motion: number
  intensity: number
  spotlight: boolean
  setMode: (mode: BackgroundMode) => void
  setMotion: (motion: number) => void
  setIntensity: (intensity: number) => void
  setSpotlight: (enabled: boolean) => void
  resetBackground: () => void
}

const BackgroundContext = createContext<BackgroundContextType>({
  mode: DEFAULT_MODE,
  motion: DEFAULT_MOTION,
  intensity: DEFAULT_INTENSITY,
  spotlight: DEFAULT_SPOTLIGHT,
  setMode: () => {},
  setMotion: () => {},
  setIntensity: () => {},
  setSpotlight: () => {},
  resetBackground: () => {},
})

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<BackgroundMode>(DEFAULT_MODE)
  const [motion, setMotion] = useState(DEFAULT_MOTION)
  const [intensity, setIntensity] = useState(DEFAULT_INTENSITY)
  const [spotlight, setSpotlight] = useState(DEFAULT_SPOTLIGHT)
  const [hydrated, setHydrated] = useState(false)
  const persistTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const stored = readStoredBackground()
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(stored.mode)
      setMotion(stored.motion)
      setIntensity(stored.intensity)
      setSpotlight(stored.spotlight)
    }
    setHydrated(true)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--bg-motion", String(motion))
    document.documentElement.style.setProperty("--bg-intensity", String(intensity))
    document.documentElement.dataset.backgroundMode = mode
  }, [mode, motion, intensity])

  useEffect(() => {
    if (!hydrated) return

    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current)
      persistTimeoutRef.current = null
    }

    const stored: StoredBackground = { mode, motion, intensity, spotlight }
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null
      window.localStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(stored))
    }, 220)

    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current)
        persistTimeoutRef.current = null
      }
    }
  }, [mode, motion, intensity, spotlight, hydrated])

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current)
        persistTimeoutRef.current = null
      }
    }
  }, [])

  function handleSetMotion(nextMotion: number) {
    setMotion(clamp(nextMotion, MOTION_MIN, MOTION_MAX))
  }

  function handleSetIntensity(nextIntensity: number) {
    setIntensity(clamp(nextIntensity, INTENSITY_MIN, INTENSITY_MAX))
  }

  function resetBackground() {
    setMode(DEFAULT_MODE)
    setMotion(DEFAULT_MOTION)
    setIntensity(DEFAULT_INTENSITY)
    setSpotlight(DEFAULT_SPOTLIGHT)
  }

  return (
    <BackgroundContext.Provider
      value={{
        mode,
        motion,
        intensity,
        spotlight,
        setMode,
        setMotion: handleSetMotion,
        setIntensity: handleSetIntensity,
        setSpotlight,
        resetBackground,
      }}
    >
      {children}
    </BackgroundContext.Provider>
  )
}

export function useBackground() {
  return useContext(BackgroundContext)
}
