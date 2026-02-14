"use client"

import { useEffect, useState } from "react"

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*"

interface ScrambleTextProps {
  text: string
  trigger?: boolean
  className?: string
  speed?: number
}

export function ScrambleText({ text, trigger = true, className, speed = 40 }: ScrambleTextProps) {
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (!trigger || reduceMotion) {
      setDisplay(text)
      return
    }

    let frame = 0
    const totalFrames = text.length + 10

    const interval = setInterval(() => {
      frame++
      const resolved = Math.floor(frame * (text.length / totalFrames))
      const result = text
        .split("")
        .map((char, i) => {
          if (char === " ") return " "
          if (i < resolved) return text[i]
          return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        })
        .join("")
      setDisplay(result)

      if (frame >= totalFrames) {
        clearInterval(interval)
        setDisplay(text)
      }
    }, speed)

    return () => clearInterval(interval)
  }, [text, trigger, speed])

  return <span className={className}>{display}</span>
}
