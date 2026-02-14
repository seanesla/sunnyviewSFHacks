"use client"

import { useRef, useEffect, useCallback } from "react"
import { useAccent } from "@/lib/accent-context"

interface Cell {
  brightness: number
  target: number
  hueOffset: number
}

export function PixelGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellsRef = useRef<Cell[]>([])
  const mouseRef = useRef({ x: -100, y: -100 })
  const hueRef = useRef(200)
  const { hue } = useAccent()
  const animRef = useRef<number>(0)

  hueRef.current = hue

  const CELL_SIZE = 40
  const GAP = 1

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

    const ctx = canvas.getContext("2d")!
    let cols = 0
    let rows = 0

    function resize() {
      const dpr = window.devicePixelRatio || 1
      canvas!.width = window.innerWidth * dpr
      canvas!.height = window.innerHeight * dpr
      canvas!.style.width = window.innerWidth + "px"
      canvas!.style.height = window.innerHeight + "px"
      ctx.scale(dpr, dpr)
      cols = Math.ceil(window.innerWidth / (CELL_SIZE + GAP)) + 1
      rows = Math.ceil(window.innerHeight / (CELL_SIZE + GAP)) + 1
      initCells(cols, rows)
    }

    resize()
    window.addEventListener("resize", resize)

    function onMouseMove(e: MouseEvent) {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener("mousemove", onMouseMove)

    function animate() {
      const w = canvas!.width / (window.devicePixelRatio || 1)
      const h = canvas!.height / (window.devicePixelRatio || 1)
      ctx.clearRect(0, 0, w, h)

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const accentHue = hueRef.current

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col
          const cell = cellsRef.current[idx]
          if (!cell) continue

          const cx = col * (CELL_SIZE + GAP) + CELL_SIZE / 2
          const cy = row * (CELL_SIZE + GAP) + CELL_SIZE / 2
          const dist = Math.sqrt((cx - mx) ** 2 + (cy - my) ** 2)

          const radius = 180
          cell.target = dist < radius ? (1 - dist / radius) * 0.35 : 0
          cell.brightness += (cell.target - cell.brightness) * 0.08

          if (cell.brightness > 0.005) {
            const h = accentHue + cell.hueOffset
            const l = 0.4 + cell.brightness * 0.3
            const c = 0.08 + cell.brightness * 0.12
            ctx.fillStyle = `oklch(${l} ${c} ${h} / ${cell.brightness})`
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

    animRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener("resize", resize)
      window.removeEventListener("mousemove", onMouseMove)
    }
  }, [initCells])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  )
}
