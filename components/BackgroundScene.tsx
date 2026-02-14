"use client"

import { AuroraBackground } from "@/components/AuroraBackground"
import { MouseSpotlight } from "@/components/MouseSpotlight"
import { PixelGrid } from "@/components/pixel-grid"
import { type BackgroundMode, useBackground } from "@/lib/background-context"
import { cn } from "@/lib/utils"

interface BackgroundSceneProps {
  mode?: BackgroundMode
  transitionMs?: number
}

export function BackgroundScene({ mode, transitionMs = 760 }: BackgroundSceneProps) {
  const { mode: contextMode, motion, intensity, spotlight } = useBackground()
  const activeMode = mode ?? contextMode
  const gridMode = activeMode === "grid"

  return (
    <>
      <div
        className={cn(
          "pointer-events-none transition-opacity ease-[cubic-bezier(0.2,0.85,0.2,1)]",
          gridMode ? "opacity-0" : "opacity-100"
        )}
        style={{ transitionDuration: `${transitionMs}ms` }}
      >
        <AuroraBackground motionScale={motion} intensity={intensity} active={!gridMode} />
      </div>

      <PixelGrid
        density={gridMode ? 1.0 : 0.82}
        intensity={intensity}
        motion={motion}
        className={cn(
          "transition-[opacity,filter] duration-700 ease-[cubic-bezier(0.2,0.85,0.2,1)]",
          gridMode
            ? "opacity-95 [filter:contrast(1.08)_brightness(0.84)]"
            : "opacity-52 [filter:contrast(0.96)_brightness(0.9)]"
        )}
      />

      {spotlight ? <MouseSpotlight strength={intensity} /> : null}
    </>
  )
}
