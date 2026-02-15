"use client"

import { useEffect, useRef } from "react"
import { useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"

interface Drop {
  x: number
  y: number
  vy: number
  len: number
  dx: number
  alpha: number
  impactY: number
  impacted: boolean
  impactAt: number
}

interface Ripple {
  x: number
  y: number
  start: number
  life: number
  amp: number
  speed: number
  ringGap: number
}

interface RaindropGridProps {
  active?: boolean
  density?: number
  intensity?: number
  motion?: number
  className?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function RaindropGrid({
  active = true,
  density = 1,
  intensity = 1,
  motion = 1,
  className,
}: RaindropGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { hue } = useAccent()
  const hueRef = useRef(hue)

  useEffect(() => {
    hueRef.current = hue
  }, [hue])

  const densityScale = clamp(density, 0.7, 1.4)
  const intensityScale = clamp(intensity, 0.65, 1.35)
  const motionScale = clamp(motion, 0.6, 1.5)

  const CELL_SIZE = Math.round(clamp(40 / densityScale, 24, 56))
  const GAP = 1
  const STRIDE = CELL_SIZE + GAP
  const MAX_RENDER_DPR = 1.7
  const FRAME_INTERVAL_MS = 40

  useEffect(() => {
    if (!active) return

    const canvasEl = canvasRef.current
    if (!canvasEl) return

    const ctx = canvasEl.getContext("2d")
    if (!ctx) return

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    let renderDpr = 1
    let viewW = 0
    let viewH = 0
    let cols = 0
    let rows = 0
    let raf: number | null = null
    let lastFrame = 0
    let lastTick = 0
    let spawnCarry = 0
    const drops: Drop[] = []
    const ripples: Ripple[] = []

    const maxDrops = Math.max(10, Math.round(12 + intensityScale * 8))
    const maxRipples = Math.max(12, Math.round(14 + intensityScale * 10))
    const spawnPerSecond = (1.1 + intensityScale * 2.4) * (0.85 + motionScale * 0.35)

    const clear = () => {
      ctx.globalCompositeOperation = "source-over"
      ctx.clearRect(0, 0, viewW, viewH)
    }

    function resize() {
      renderDpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      canvasEl.width = Math.floor(window.innerWidth * renderDpr)
      canvasEl.height = Math.floor(window.innerHeight * renderDpr)
      canvasEl.style.width = `${window.innerWidth}px`
      canvasEl.style.height = `${window.innerHeight}px`
      ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0)

      viewW = canvasEl.width / renderDpr
      viewH = canvasEl.height / renderDpr
      cols = Math.max(1, Math.ceil(viewW / STRIDE) + 1)
      rows = Math.max(1, Math.ceil(viewH / STRIDE) + 1)
      drops.length = 0
      ripples.length = 0
      spawnCarry = 0
      clear()
    }

    const spawnRipple = (x: number, y: number, now: number, energy: number) => {
      const life = rand(900, 1250) / (0.88 + motionScale * 0.25)
      ripples.push({
        x,
        y,
        start: now,
        life,
        amp: clamp(0.22 * intensityScale * energy, 0.06, 0.45),
        speed: rand(260, 420) * (0.85 + motionScale * 0.45),
        ringGap: STRIDE * rand(0.65, 0.9),
      })
      if (ripples.length > maxRipples) {
        ripples.splice(0, ripples.length - maxRipples)
      }
    }

    const spawnDrop = (now: number) => {
      const col = Math.floor(Math.random() * cols)
      const row = 1 + Math.floor(Math.random() * Math.max(1, rows - 2))
      const x = col * STRIDE + CELL_SIZE / 2 + rand(-1.5, 1.5)
      const impactY = row * STRIDE + CELL_SIZE / 2 + rand(-1.5, 1.5)
      const fallDistance = rand(viewH * 0.3, viewH * 1.05)
      const y = impactY - fallDistance
      const len = rand(70, 170) * (0.85 + motionScale * 0.25)
      const vy = rand(900, 1500) * (0.85 + motionScale * 0.4)
      const dx = rand(-10, 10) * (0.45 + motionScale * 0.35)
      const alpha = rand(0.45, 1.0)

      drops.push({ x, y, vy, len, dx, alpha, impactY, impacted: false, impactAt: 0 })
      if (drops.length > maxDrops) {
        drops.splice(0, drops.length - maxDrops)
      }
    }

    const stop = () => {
      if (raf === null) return
      cancelAnimationFrame(raf)
      raf = null
    }

    const start = () => {
      if (raf !== null) return
      lastFrame = 0
      lastTick = 0
      raf = requestAnimationFrame(tick)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
        return
      }
      lastFrame = 0
      lastTick = 0
      start()
    }

    function tick(now: number) {
      if (now - lastFrame < FRAME_INTERVAL_MS) {
        raf = requestAnimationFrame(tick)
        return
      }

      const prev = lastTick || now
      const dtMs = Math.min(64, Math.max(12, now - prev))
      const dt = dtMs / 1000
      lastTick = now
      lastFrame = now

      spawnCarry += spawnPerSecond * dt
      while (spawnCarry >= 1) {
        spawnCarry -= 1
        if (drops.length >= maxDrops) break
        spawnDrop(now)
      }

      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]
        d.y += d.vy * dt

        if (!d.impacted && d.y >= d.impactY) {
          d.impacted = true
          d.impactAt = now
          d.y = d.impactY
          spawnRipple(d.x, d.impactY, now, d.alpha)
        }

        if (d.impacted) {
          const t = (now - d.impactAt) / 260
          if (t >= 1) {
            drops.splice(i, 1)
            continue
          }
        } else if (d.y - d.len > viewH + 40) {
          drops.splice(i, 1)
          continue
        }
      }

      clear()
      ctx.globalCompositeOperation = "lighter"
      ctx.lineCap = "round"
      ctx.lineJoin = "round"

      const accentHue = hueRef.current

      for (const d of drops) {
        const impacted = d.impacted
        const fade = impacted ? Math.max(0, 1 - (now - d.impactAt) / 260) : 1
        const alpha = (0.06 + intensityScale * 0.06) * d.alpha * fade
        if (alpha <= 0.001) continue

        const len = d.len * (impacted ? 0.35 + fade * 0.35 : 1)
        const x1 = d.x - d.dx * 0.18
        const y1 = d.y - len
        const x2 = d.x + d.dx * 0.18
        const y2 = d.y

        const grad = ctx.createLinearGradient(x1, y1, x2, y2)
        grad.addColorStop(0, `oklch(0.86 0.06 ${accentHue} / 0)`) 
        grad.addColorStop(0.6, `oklch(0.86 0.06 ${accentHue} / ${(alpha * 0.75).toFixed(4)})`)
        grad.addColorStop(1, `oklch(0.9 0.08 ${accentHue} / ${(alpha * 1.15).toFixed(4)})`)

        ctx.strokeStyle = grad
        ctx.lineWidth = impacted ? 1 : 1.3
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()

        if (impacted && fade > 0.2) {
          const dotAlpha = alpha * 0.9
          ctx.fillStyle = `oklch(0.92 0.1 ${accentHue} / ${dotAlpha.toFixed(4)})`
          ctx.beginPath()
          ctx.arc(d.x, d.impactY, 1.2 + (1 - fade) * 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        const age = now - r.start
        if (age >= r.life) {
          ripples.splice(i, 1)
          continue
        }

        const t = age / r.life
        const baseAlpha = r.amp * Math.pow(1 - t, 1.6)
        const radius0 = r.speed * (age / 1000)
        const rings = 3

        for (let k = 0; k < rings; k++) {
          const radius = radius0 - k * r.ringGap
          if (radius <= 0) continue
          const a = baseAlpha * (1 - k * 0.22)
          if (a <= 0.002) continue

          ctx.strokeStyle = `oklch(0.86 0.05 ${accentHue} / ${a.toFixed(4)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      raf = requestAnimationFrame(tick)
    }

    resize()
    window.addEventListener("resize", resize)
    document.addEventListener("visibilitychange", onVisibilityChange)
    start()

    return () => {
      stop()
      window.removeEventListener("resize", resize)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [active, CELL_SIZE, STRIDE, intensityScale, maxRipples, maxDrops, motionScale, spawnPerSecond])

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none fixed inset-0 z-0", className)}
      aria-hidden="true"
    />
  )
}
