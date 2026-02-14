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

const ACCENT_EASE_TIME_MS = 210
const CSS_FRAME_MIN_MS = 46
const STATE_FRAME_MIN_MS = 74
const HUE_SETTLE_EPSILON = 0.24
const SAT_SETTLE_EPSILON = 0.0012
const ACCENT_VALUE_EPSILON = 0.0001

export const ACCENT_SAT_MIN = 0.06
export const ACCENT_SAT_MAX = 0.28

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function normalizeHue(hue: number): number {
  const normalized = hue % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function shortestHueDelta(fromHue: number, toHue: number): number {
  return ((normalizeHue(toHue) - normalizeHue(fromHue) + 540) % 360) - 180
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
  const [accent, setAccentState] = useState<StoredAccent>({
    hue: DEFAULT_HUE,
    saturation: DEFAULT_SATURATION,
  })
  const [hydrated, setHydrated] = useState(false)
  const targetAccentRef = useRef<StoredAccent>({
    hue: DEFAULT_HUE,
    saturation: DEFAULT_SATURATION,
  })
  const displayAccentRef = useRef<StoredAccent>({
    hue: DEFAULT_HUE,
    saturation: DEFAULT_SATURATION,
  })
  const frameRef = useRef<number | null>(null)
  const lastTickRef = useRef<number | null>(null)
  const lastCssWriteRef = useRef(0)
  const lastStateCommitRef = useRef(0)
  const persistTimeoutRef = useRef<number | null>(null)

  const writeDocumentAccent = useCallback((nextAccent: StoredAccent) => {
    document.documentElement.style.setProperty("--accent-hue", String(nextAccent.hue))
    document.documentElement.style.setProperty("--accent-sat", String(nextAccent.saturation))
  }, [])

  const commitAccentState = useCallback((nextAccent: StoredAccent) => {
    setAccentState((prevAccent) => {
      const hueDelta = Math.abs(shortestHueDelta(prevAccent.hue, nextAccent.hue))
      const saturationDelta = Math.abs(prevAccent.saturation - nextAccent.saturation)
      if (
        hueDelta <= ACCENT_VALUE_EPSILON &&
        saturationDelta <= ACCENT_VALUE_EPSILON
      ) {
        return prevAccent
      }
      return nextAccent
    })
  }, [])

  const startAccentAnimation = useCallback(() => {
    if (frameRef.current !== null) return

    const tick = (now: number) => {
      const lastNow = lastTickRef.current ?? now
      const dt = Math.max(8, Math.min(80, now - lastNow))
      lastTickRef.current = now

      const currentAccent = displayAccentRef.current
      const targetAccent = targetAccentRef.current

      const alpha = 1 - Math.exp(-dt / ACCENT_EASE_TIME_MS)

      const hueDelta = shortestHueDelta(currentAccent.hue, targetAccent.hue)
      const nextHue = normalizeHue(currentAccent.hue + hueDelta * alpha)
      const nextSaturation =
        currentAccent.saturation +
        (targetAccent.saturation - currentAccent.saturation) * alpha

      const nextAccent: StoredAccent = {
        hue: nextHue,
        saturation: nextSaturation,
      }

      displayAccentRef.current = nextAccent

      const hueRemaining = Math.abs(shortestHueDelta(nextAccent.hue, targetAccent.hue))
      const saturationRemaining = Math.abs(nextAccent.saturation - targetAccent.saturation)
      const settled =
        hueRemaining <= HUE_SETTLE_EPSILON &&
        saturationRemaining <= SAT_SETTLE_EPSILON

      const accentForWrite = settled ? targetAccent : nextAccent

      if (settled || now - lastCssWriteRef.current >= CSS_FRAME_MIN_MS) {
        writeDocumentAccent(accentForWrite)
        lastCssWriteRef.current = now
      }

      if (settled || now - lastStateCommitRef.current >= STATE_FRAME_MIN_MS) {
        commitAccentState(accentForWrite)
        lastStateCommitRef.current = now
      }

      if (settled) {
        displayAccentRef.current = targetAccent
        frameRef.current = null
        lastTickRef.current = null
        return
      }

      frameRef.current = window.requestAnimationFrame(tick)
    }

    frameRef.current = window.requestAnimationFrame(tick)
  }, [commitAccentState, writeDocumentAccent])

  const updateTargetAccent = useCallback(
    (nextAccent: StoredAccent) => {
      const normalizedAccent: StoredAccent = {
        hue: normalizeHue(nextAccent.hue),
        saturation: clamp(nextAccent.saturation, ACCENT_SAT_MIN, ACCENT_SAT_MAX),
      }

      const previousTarget = targetAccentRef.current
      const hueDelta = Math.abs(
        shortestHueDelta(previousTarget.hue, normalizedAccent.hue)
      )
      const saturationDelta = Math.abs(
        previousTarget.saturation - normalizedAccent.saturation
      )

      if (
        hueDelta <= ACCENT_VALUE_EPSILON &&
        saturationDelta <= ACCENT_VALUE_EPSILON
      ) {
        return
      }

      targetAccentRef.current = normalizedAccent
      startAccentAnimation()
    },
    [startAccentAnimation]
  )

  useEffect(() => {
    const storedAccent = readStoredAccent()
    const initialAccent = storedAccent ?? {
      hue: DEFAULT_HUE,
      saturation: DEFAULT_SATURATION,
    }

    targetAccentRef.current = initialAccent
    displayAccentRef.current = initialAccent
    writeDocumentAccent(initialAccent)

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccentState(initialAccent)
    setHydrated(true)
  }, [writeDocumentAccent])

  const hue = accent.hue
  const saturation = accent.saturation

  useEffect(() => {
    if (!hydrated) return

    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current)
      persistTimeoutRef.current = null
    }

    const stored: StoredAccent = {
      hue,
      saturation,
    }
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

  const handleSetHue = useCallback(
    (nextHue: number) => {
      updateTargetAccent({
        hue: nextHue,
        saturation: targetAccentRef.current.saturation,
      })
    },
    [updateTargetAccent]
  )

  const handleSetSaturation = useCallback(
    (nextSaturation: number) => {
      updateTargetAccent({
        hue: targetAccentRef.current.hue,
        saturation: nextSaturation,
      })
    },
    [updateTargetAccent]
  )

  const resetAccent = useCallback(() => {
    updateTargetAccent({
      hue: DEFAULT_HUE,
      saturation: DEFAULT_SATURATION,
    })
  }, [updateTargetAccent])

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
