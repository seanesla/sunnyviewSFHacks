"use client"

import { useRef, useEffect, useCallback } from "react"
import { useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"

interface Cell {
  brightness: number
  target: number
  hueOffset: number
}

interface PixelGridProps {
  density?: number
  intensity?: number
  motion?: number
  className?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function PixelGrid({ density = 1, intensity = 1, motion = 1, className }: PixelGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellsRef = useRef<Cell[]>([])
  const mouseRef = useRef({ x: -100, y: -100 })
  const hueRef = useRef(200)
  const { hue } = useAccent()
  const animRef = useRef<number>(0)
  const lastFrameRef = useRef(0)

  useEffect(() => {
    hueRef.current = hue
  }, [hue])

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
    }

    resize()
    window.addEventListener("resize", resize)

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY }
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
      if (now - lastFrameRef.current < FRAME_INTERVAL_MS) {
        animRef.current = requestAnimationFrame(animate)
        return
      }
      lastFrameRef.current = now

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
