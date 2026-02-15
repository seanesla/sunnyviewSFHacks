"use client"

import { useRef, useEffect, useCallback } from "react"
import { useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"

interface Cell {
  brightness: number
  target: number
  hueOffset: number
}

interface Twinkle {
  x: number
  y: number
  start: number
  life: number
  amp: number
  rot: number
  hueOffset: number
}

interface CursorSpark {
  x: number
  y: number
  vx: number
  vy: number
  start: number
  life: number
  amp: number
  r: number
  hueOffset: number
}

interface PixelGridProps {
  density?: number
  intensity?: number
  motion?: number
  sparkle?: boolean
  cursorFx?: boolean
  className?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function PixelGrid({
  density = 1,
  intensity = 1,
  motion = 1,
  sparkle = false,
  cursorFx = false,
  className,
}: PixelGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellsRef = useRef<Cell[]>([])
  const mouseRef = useRef({ x: -100, y: -100 })
  const hueRef = useRef(200)
  const { hue } = useAccent()
  const animRef = useRef<number>(0)
  const lastFrameRef = useRef(0)
  const sparkleRef = useRef(sparkle)
  const cursorFxRef = useRef(cursorFx)

  useEffect(() => {
    hueRef.current = hue
  }, [hue])

  useEffect(() => {
    sparkleRef.current = sparkle
    cursorFxRef.current = cursorFx
  }, [cursorFx, sparkle])

  const densityScale = clamp(density, 0.7, 1.4)
  const intensityScale = clamp(intensity, 0.65, 1.35)
  const motionScale = clamp(motion, 0.6, 1.5)

  const CELL_SIZE = Math.round(clamp(40 / densityScale, 24, 56))
  const GAP = 1
  const MAX_RENDER_DPR = 1.6
  const FRAME_INTERVAL_MS = 40

  const initCells = useCallback((cols: number, rows: number) => {
    const cells: Cell[] = []
    for (let i = 0; i < cols * rows; i++) {
      cells.push({
        brightness: 0,
        target: 0,
        hueOffset: (Math.random() - 0.5) * 30,
      })
    }
    cellsRef.current = cells
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasEl = canvas

    const ctx = canvasEl.getContext("2d")!
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    let cols = 0
    let rows = 0
    let renderDpr = 1
    const cellStride = CELL_SIZE + GAP

    const twinkles: Twinkle[] = []
    const sparks: CursorSpark[] = []
    let twinkleCarry = 0
    let sparkCarry = 0
    let cursorX = window.innerWidth / 2
    let cursorY = window.innerHeight / 2
    let cursorPrevX = cursorX
    let cursorPrevY = cursorY
    let hasMouse = false

    const snapIntersection = (x: number, offset: number) => {
      return offset + Math.round((x - offset) / cellStride) * cellStride
    }

    function resize() {
      renderDpr = Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      canvasEl.width = Math.floor(window.innerWidth * renderDpr)
      canvasEl.height = Math.floor(window.innerHeight * renderDpr)
      canvasEl.style.width = `${window.innerWidth}px`
      canvasEl.style.height = `${window.innerHeight}px`
      ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0)
      cols = Math.ceil(window.innerWidth / cellStride) + 1
      rows = Math.ceil(window.innerHeight / cellStride) + 1
      initCells(cols, rows)
      twinkles.length = 0
      sparks.length = 0
      twinkleCarry = 0
      sparkCarry = 0
    }

    resize()
    window.addEventListener("resize", resize)

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY }
      hasMouse = true
    }
    window.addEventListener("mousemove", onMouseMove)

    if (reduceMotion) {
      const w = canvasEl.width / renderDpr
      const h = canvasEl.height / renderDpr
      ctx.clearRect(0, 0, w, h)
      return () => {
        window.removeEventListener("resize", resize)
        window.removeEventListener("mousemove", onMouseMove)
      }
    }

    function animate() {
      const now = performance.now()
      const prevNow = lastFrameRef.current
      if (now - prevNow < FRAME_INTERVAL_MS) {
        animRef.current = requestAnimationFrame(animate)
        return
      }
      lastFrameRef.current = now

      const dtMs = prevNow ? Math.min(72, Math.max(12, now - prevNow)) : FRAME_INTERVAL_MS
      const dt = dtMs / 1000

      const w = canvasEl.width / renderDpr
      const h = canvasEl.height / renderDpr
      ctx.clearRect(0, 0, w, h)

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const accentHue = hueRef.current
      const ambientPulse = 0.5 + Math.sin(now * 0.0006 * motionScale) * 0.5
      const radius = 180 * motionScale
      const radiusSq = radius * radius
      const ambient = (0.012 + ambientPulse * 0.02) * intensityScale

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col
          const cell = cellsRef.current[idx]
          if (!cell) continue

          const cx = col * cellStride + CELL_SIZE / 2
          const cy = row * cellStride + CELL_SIZE / 2

          if (reduceMotion) {
            const drift = (Math.sin(now * 0.00035 + row * 0.32 + col * 0.24) + 1) * 0.5
            cell.target = ambient * (0.4 + drift * 0.4)
          } else {
            const dx = cx - mx
            const dy = cy - my
            const distSq = dx * dx + dy * dy
            const hover =
              distSq < radiusSq
                ? (1 - Math.sqrt(distSq) / radius) * 0.34 * intensityScale
                : 0
            cell.target = hover + ambient * 0.35
          }

          const smoothing = reduceMotion ? 0.05 : clamp(0.08 * motionScale, 0.06, 0.14)
          cell.brightness += (cell.target - cell.brightness) * smoothing

          if (cell.brightness > 0.005) {
            const h = accentHue + cell.hueOffset
            const l = 0.4 + cell.brightness * 0.3
            const c = 0.08 + cell.brightness * 0.12
            const alpha = clamp(cell.brightness * 1.05, 0, 0.5)
            ctx.fillStyle = `oklch(${l} ${c} ${h} / ${alpha})`
            ctx.fillRect(
              col * (CELL_SIZE + GAP),
              row * (CELL_SIZE + GAP),
              CELL_SIZE,
              CELL_SIZE
            )
          }
        }
      }

      const sparkleEnabled = sparkleRef.current
      const cursorEnabled = cursorFxRef.current
      if (!sparkleEnabled) {
        twinkles.length = 0
        twinkleCarry = 0
      }
      if (!cursorEnabled) {
        sparks.length = 0
        sparkCarry = 0
      }

      if (sparkleEnabled || cursorEnabled) {
        ctx.globalCompositeOperation = "lighter"
        ctx.lineCap = "round"
        ctx.lineJoin = "round"

        const accentHue = hueRef.current
        const nowSec = now * 0.001

        if (sparkleEnabled) {
          const twinklesPerSec = (0.9 + intensityScale * 1.8) * (0.75 + motionScale * 0.55)
          twinkleCarry += twinklesPerSec * dt

          const maxTwinkles = Math.max(10, Math.round(12 + intensityScale * 10))
          while (twinkleCarry >= 1) {
            twinkleCarry -= 1
            const col = Math.floor(Math.random() * Math.max(1, cols - 1))
            const row = Math.floor(Math.random() * Math.max(1, rows - 1))
            const x = col * cellStride + CELL_SIZE
            const y = row * cellStride + CELL_SIZE
            twinkles.push({
              x,
              y,
              start: now,
              life: (760 + Math.random() * 980) / (0.88 + motionScale * 0.25),
              amp: (0.055 + Math.random() * 0.12) * intensityScale,
              rot: Math.random() * Math.PI * 2,
              hueOffset: (Math.random() - 0.5) * 26,
            })
            if (twinkles.length > maxTwinkles) {
              twinkles.splice(0, twinkles.length - maxTwinkles)
            }
          }

          for (let i = twinkles.length - 1; i >= 0; i--) {
            const t = twinkles[i]
            const age = now - t.start
            if (age >= t.life) {
              twinkles.splice(i, 1)
              continue
            }

            const p = age / t.life
            const fade = Math.pow(1 - p, 1.55)
            const pulse = 0.55 + 0.45 * Math.sin(nowSec * (4.2 + motionScale * 2.2) + t.rot)
            const a = clamp(t.amp * fade * (0.55 + pulse * 0.8), 0, 0.22)
            if (a <= 0.002) continue

            const h = accentHue + t.hueOffset
            const ray = (2.4 + pulse * 5.8) * (0.95 + intensityScale * 0.15)

            ctx.strokeStyle = `oklch(0.94 0.1 ${h} / ${a.toFixed(4)})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(t.x - ray, t.y)
            ctx.lineTo(t.x + ray, t.y)
            ctx.moveTo(t.x, t.y - ray)
            ctx.lineTo(t.x, t.y + ray)
            ctx.stroke()

            ctx.fillStyle = `oklch(0.96 0.12 ${h} / ${(a * 1.05).toFixed(4)})`
            ctx.beginPath()
            ctx.arc(t.x, t.y, 1.15 + pulse * 0.85, 0, Math.PI * 2)
            ctx.fill()
          }
        }

        if (cursorEnabled && hasMouse) {
          const target = mouseRef.current
          const targetX = target.x
          const targetY = target.y
          const smoothing = 1 - Math.exp(-(12 + motionScale * 12) * dt)
          cursorX += (targetX - cursorX) * smoothing
          cursorY += (targetY - cursorY) * smoothing

          const dx = cursorX - cursorPrevX
          const dy = cursorY - cursorPrevY
          const speed = Math.min(2600, Math.hypot(dx, dy) / Math.max(0.012, dt))
          const dirLen = Math.max(0.001, Math.hypot(dx, dy))
          const nx = dx / dirLen
          const ny = dy / dirLen

          sparkCarry += (speed / 880) * (0.65 + intensityScale * 0.7) * dt
          while (sparkCarry >= 1) {
            sparkCarry -= 1
            const back = 18 + speed * 0.01
            const px = cursorX - nx * back
            const py = cursorY - ny * back
            const gx = snapIntersection(px, CELL_SIZE)
            const gy = snapIntersection(py, CELL_SIZE)

            const perpX = -ny
            const perpY = nx
            sparks.push({
              x: gx + (Math.random() - 0.5) * 9,
              y: gy + (Math.random() - 0.5) * 9,
              vx:
                (perpX * (Math.random() * 260 - 130) + nx * (Math.random() * 120 - 40)) *
                (0.8 + motionScale * 0.35),
              vy:
                (perpY * (Math.random() * 260 - 130) + ny * (Math.random() * 120 - 40)) *
                (0.8 + motionScale * 0.35),
              start: now,
              life: (520 + Math.random() * 560) / (0.9 + motionScale * 0.25),
              amp: (0.07 + Math.random() * 0.18) * (0.7 + intensityScale * 0.55),
              r: 0.9 + Math.random() * 1.9,
              hueOffset: (Math.random() - 0.5) * 18,
            })
            if (sparks.length > 72) sparks.splice(0, sparks.length - 72)
          }

          for (let i = sparks.length - 1; i >= 0; i--) {
            const s = sparks[i]
            const age = now - s.start
            if (age >= s.life) {
              sparks.splice(i, 1)
              continue
            }
            const drag = 1 - 0.22 * dt
            s.vx *= drag
            s.vy *= drag
            s.x += s.vx * dt
            s.y += s.vy * dt
          }

          const snapX = snapIntersection(cursorX, CELL_SIZE)
          const snapY = snapIntersection(cursorY, CELL_SIZE)
          const snapDist = Math.hypot(snapX - cursorX, snapY - cursorY)
          const snapA = clamp(1 - snapDist / 26, 0, 1) * (0.08 + intensityScale * 0.08)
          if (snapA > 0.003) {
            ctx.strokeStyle = `oklch(0.94 0.1 ${accentHue} / ${snapA.toFixed(4)})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(cursorX, cursorY)
            ctx.lineTo(snapX, snapY)
            ctx.stroke()

            const ray = 5.2 + (1 - snapDist / 26) * 6.2
            ctx.beginPath()
            ctx.moveTo(snapX - ray, snapY)
            ctx.lineTo(snapX + ray, snapY)
            ctx.moveTo(snapX, snapY - ray)
            ctx.lineTo(snapX, snapY + ray)
            ctx.stroke()
          }

          const pulse = 0.5 + 0.5 * Math.sin(nowSec * (1.8 + motionScale * 0.9))
          const ringR = 20 + intensityScale * 9 + pulse * 7
          const ringA = (0.06 + intensityScale * 0.06) * (0.65 + pulse * 0.75)

          ctx.strokeStyle = `oklch(0.92 0.1 ${accentHue} / ${ringA.toFixed(4)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(cursorX, cursorY, ringR, 0, Math.PI * 2)
          ctx.stroke()

          const burst = 10 + pulse * 10 + Math.min(18, speed * 0.01)
          ctx.strokeStyle = `oklch(0.94 0.12 ${accentHue} / ${(ringA * 1.25).toFixed(4)})`
          ctx.beginPath()
          ctx.moveTo(cursorX - burst, cursorY)
          ctx.lineTo(cursorX + burst, cursorY)
          ctx.moveTo(cursorX, cursorY - burst)
          ctx.lineTo(cursorX, cursorY + burst)
          ctx.stroke()

          if (speed > 90) {
            const trailAlpha = clamp((speed / 1500) * (0.18 + intensityScale * 0.08), 0, 0.22)
            if (trailAlpha > 0.004) {
              const grad = ctx.createLinearGradient(cursorPrevX, cursorPrevY, cursorX, cursorY)
              grad.addColorStop(0, `oklch(0.86 0.08 ${accentHue} / 0)`)
              grad.addColorStop(1, `oklch(0.92 0.1 ${accentHue} / ${trailAlpha.toFixed(4)})`)
              ctx.strokeStyle = grad
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(cursorPrevX, cursorPrevY)
              ctx.lineTo(cursorX, cursorY)
              ctx.stroke()
            }
          }

          for (const s of sparks) {
            const age = now - s.start
            const p = age / s.life
            const fade = Math.pow(1 - p, 1.7)
            const a = clamp(s.amp * fade, 0, 0.26)
            if (a <= 0.002) continue

            const h = accentHue + s.hueOffset
            ctx.fillStyle = `oklch(0.94 0.12 ${h} / ${a.toFixed(4)})`
            ctx.beginPath()
            ctx.arc(s.x, s.y, s.r * (0.7 + fade * 0.95), 0, Math.PI * 2)
            ctx.fill()

            if (s.r > 1.35) {
              const ray = s.r * (2.2 + fade * 2.2)
              ctx.strokeStyle = `oklch(0.96 0.14 ${h} / ${(a * 0.72).toFixed(4)})`
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(s.x - ray, s.y)
              ctx.lineTo(s.x + ray, s.y)
              ctx.moveTo(s.x, s.y - ray)
              ctx.lineTo(s.x, s.y + ray)
              ctx.stroke()
            }
          }

          cursorPrevX = cursorX
          cursorPrevY = cursorY
        }
      }

      animRef.current = requestAnimationFrame(animate)
    }

    const startAnimation = () => {
      if (animRef.current !== 0) return
      animRef.current = requestAnimationFrame(animate)
    }

    const stopAnimation = () => {
      if (animRef.current === 0) return
      cancelAnimationFrame(animRef.current)
      animRef.current = 0
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stopAnimation()
        return
      }
      lastFrameRef.current = 0
      startAnimation()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    startAnimation()

    return () => {
      stopAnimation()
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [CELL_SIZE, FRAME_INTERVAL_MS, initCells, intensityScale, motionScale])

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none fixed inset-0 z-0", className)}
      aria-hidden="true"
    />
  )
}
