"use client"

import { useRef, useEffect, useCallback } from "react"
import { useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"

interface Cell {
  brightness: number
  target: number
  hueOffset: number
  sparkle: number
  sparklePhase: number
  sparkleRate: number
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

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
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
        sparkle: 0,
        sparklePhase: Math.random() * Math.PI * 2,
        sparkleRate: rand(0.2, 0.8),
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

    let sparkleCarry = 0
    let cursorX = window.innerWidth / 2
    let cursorY = window.innerHeight / 2
    let cursorLastX = cursorX
    let cursorLastY = cursorY
    let hasMouse = false

    const igniteCell = (index: number, power: number) => {
      const cell = cellsRef.current[index]
      if (!cell) return
      cell.sparkle = Math.max(cell.sparkle, power)
    }

    const igniteAmbientCluster = (centerCol: number, centerRow: number, basePower: number) => {
      const radius = Math.random() < 0.36 ? 2 : 1
      for (let rowOff = -radius; rowOff <= radius; rowOff++) {
        for (let colOff = -radius; colOff <= radius; colOff++) {
          const col = centerCol + colOff
          const row = centerRow + rowOff
          if (col < 0 || row < 0 || col >= cols || row >= rows) continue

          const dist = Math.hypot(colOff, rowOff)
          if (dist > radius + 0.05) continue
          if (dist > 0 && Math.random() > 0.28) continue

          const falloff = Math.max(0, 1 - dist / (radius + 0.35))
          if (falloff <= 0) continue

          const power = basePower * falloff * rand(0.82, 1.24)
          igniteCell(row * cols + col, power)
        }
      }
    }

    const spawnAmbientSparkles = (dt: number) => {
      if (!sparkleRef.current) {
        sparkleCarry = 0
        return
      }

      const sparklesPerSecond = (3.3 + intensityScale * 3.2) * (0.68 + motionScale * 0.24)
      sparkleCarry += sparklesPerSecond * dt
      let spawned = 0

      while (sparkleCarry >= 1 && spawned < 18) {
        sparkleCarry -= 1
        spawned += 1

        if (cols <= 0 || rows <= 0) break
        const centerCol = Math.floor(Math.random() * cols)
        const centerRow = Math.floor(Math.random() * rows)
        const basePower = rand(0.26, 0.57) * intensityScale
        igniteAmbientCluster(centerCol, centerRow, basePower)
      }
    }

    const driveCursorSparkles = (dt: number) => {
      if (!(sparkleRef.current && cursorFxRef.current && hasMouse)) return

      const target = mouseRef.current
      const smoothing = 1 - Math.exp(-(11 + motionScale * 10) * dt)
      cursorX += (target.x - cursorX) * smoothing
      cursorY += (target.y - cursorY) * smoothing

      const speed = Math.hypot(cursorX - cursorLastX, cursorY - cursorLastY) / Math.max(0.012, dt)
      const moveBoost = clamp(speed / 1200, 0, 1)
      const baseRadiusCells = speed > 650 ? 2 : 1
      const radiusCells = baseRadiusCells / 1.35

      const centerCol = Math.round((cursorX - CELL_SIZE / 2) / cellStride)
      const centerRow = Math.round((cursorY - CELL_SIZE / 2) / cellStride)

      for (let rowOff = -baseRadiusCells; rowOff <= baseRadiusCells; rowOff++) {
        for (let colOff = -baseRadiusCells; colOff <= baseRadiusCells; colOff++) {
          const col = centerCol + colOff
          const row = centerRow + rowOff
          if (col < 0 || row < 0 || col >= cols || row >= rows) continue

          const dist = Math.hypot(colOff, rowOff)
          if (dist > baseRadiusCells + 0.05) continue
          const falloff = Math.max(0, 1 - dist / (radiusCells + 0.55))
          if (falloff <= 0) continue

          const idx = row * cols + col
          const power =
            falloff * (0.2 + intensityScale * 0.31) * (0.74 + moveBoost * 0.42)
          igniteCell(idx, power)
        }
      }

      cursorLastX = cursorX
      cursorLastY = cursorY
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
      sparkleCarry = 0
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
      ctx.globalCompositeOperation = "source-over"
      ctx.clearRect(0, 0, w, h)

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const accentHue = hueRef.current

      spawnAmbientSparkles(dt)
      driveCursorSparkles(dt)

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

          if (sparkleRef.current) {
            const sparkleDecay = Math.exp(-dt * (0.52 + motionScale * 0.13))
            cell.sparkle *= sparkleDecay
            if (cell.sparkle < 0.001) cell.sparkle = 0
          } else {
            cell.sparkle = 0
          }

          const sparklePulse =
            cell.sparkle > 0
              ? cell.sparkle *
                (0.82 +
                  0.18 *
                    Math.sin(
                      now *
                        0.001 *
                        (1.15 + cell.sparkleRate * (0.7 + motionScale * 0.2)) +
                        cell.sparklePhase
                    ))
              : 0

          const sparkleBoost = Math.max(0, sparklePulse)
          const combined = cell.brightness + sparkleBoost * 1.12

          if (combined > 0.005) {
            const h = accentHue + cell.hueOffset + sparkleBoost * 22
            const l = 0.39 + cell.brightness * 0.26 + sparkleBoost * 0.4
            const c = 0.08 + cell.brightness * 0.11 + sparkleBoost * 0.19
            const alpha = clamp(cell.brightness * 1.02 + sparkleBoost * 1.14, 0, 0.72)
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
