"use client"

import { useEffect } from "react"
import { cn } from "@/lib/utils"

interface MouseSpotlightProps {
  strength?: number
  className?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function MouseSpotlight({ strength = 1, className }: MouseSpotlightProps) {
  const strengthScale = clamp(strength, 0.65, 1.35)

  useEffect(() => {
    const root = document.documentElement
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight / 2
    let currentX = targetX
    let currentY = targetY
    let raf = 0

    const setMouseVars = (x: number, y: number) => {
      root.style.setProperty("--mouse-x", `${x}px`)
      root.style.setProperty("--mouse-y", `${y}px`)
    }

    const handler = (e: MouseEvent) => {
      targetX = e.clientX
      targetY = e.clientY

      if (reduceMotion) {
        currentX = targetX
        currentY = targetY
        setMouseVars(currentX, currentY)
      }
    }

    const tick = () => {
      const smoothing = 0.12
      currentX += (targetX - currentX) * smoothing
      currentY += (targetY - currentY) * smoothing
      setMouseVars(currentX, currentY)
      raf = requestAnimationFrame(tick)
    }

    setMouseVars(currentX, currentY)
    window.addEventListener("mousemove", handler)

    if (!reduceMotion) {
      raf = requestAnimationFrame(tick)
    }

    return () => {
      window.removeEventListener("mousemove", handler)
      if (raf) {
        cancelAnimationFrame(raf)
      }
    }
  }, [])

  const glowRadius = Math.round(420 + strengthScale * 160)
  const glowAlpha = (0.028 + strengthScale * 0.025).toFixed(3)

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-0 opacity-20 transition-opacity duration-300 motion-reduce:hidden",
        className
      )}
      style={{
        background:
          `radial-gradient(${glowRadius}px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), oklch(0.72 0.12 var(--accent-hue) / ${glowAlpha}), transparent 44%)`,
      }}
    />
  )
}
