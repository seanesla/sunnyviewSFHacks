"use client"

import { AuroraBackground } from "@/components/AuroraBackground"
import { MouseSpotlight } from "@/components/MouseSpotlight"
import { PixelGrid } from "@/components/pixel-grid"
import { PrismBackground } from "@/components/PrismBackground"
import { useBackground } from "@/lib/background-context"

export function BackgroundScene() {
  const { mode, motion, intensity, spotlight } = useBackground()

  return (
    <>
      {(mode === "aurora" || mode === "fusion") && (
        <AuroraBackground motionScale={motion} intensity={intensity} />
      )}

      {(mode === "grid" || mode === "fusion") && (
        <PixelGrid
          density={mode === "grid" ? 1.1 : 0.9}
          intensity={intensity}
          motion={motion}
          className={mode === "fusion" ? "opacity-65" : undefined}
        />
      )}

      {mode === "prism" && <PrismBackground motionScale={motion} intensity={intensity} />}

      {spotlight ? <MouseSpotlight strength={intensity} /> : null}
    </>
  )
}
