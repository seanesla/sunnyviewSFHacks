"use client"

import { useMemo, type CSSProperties } from "react"

interface PrismBackgroundProps {
  motionScale?: number
  intensity?: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function PrismBackground({ motionScale = 1, intensity = 1 }: PrismBackgroundProps) {
  const motionStrength = clamp(motionScale, 0.6, 1.5)
  const intensityStrength = clamp(intensity, 0.65, 1.35)

  const style = useMemo(
    () =>
      ({
        "--sv-bg-motion": String(motionStrength),
        "--sv-bg-intensity": String(intensityStrength),
      }) as CSSProperties,
    [motionStrength, intensityStrength]
  )

  return (
    <div className="sv-bg sv-bg--prism" style={style} aria-hidden="true">
      <div className="sv-prism__cone sv-prism__cone--a" />
      <div className="sv-prism__cone sv-prism__cone--b" />
      <div className="sv-prism__rings" />
      <div className="sv-prism__noise" />
      <div className="sv-bg__vignette" />
    </div>
  )
}
