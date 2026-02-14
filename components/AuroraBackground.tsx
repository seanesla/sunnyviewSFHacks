"use client"

import { useLayoutEffect, useMemo, useRef } from "react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

type OrbSpec = {
  id: string
  variantClass: string
  left: string
  top: string
  size: string
  depth: number
  drift: number
}

const ORBS: OrbSpec[] = [
  { id: "a", variantClass: "sv-bg__orb--a", left: "16%", top: "18%", size: "78vmax", depth: 0.18, drift: 1.0 },
  { id: "b", variantClass: "sv-bg__orb--b", left: "86%", top: "16%", size: "68vmax", depth: 0.24, drift: 0.92 },
  { id: "c", variantClass: "sv-bg__orb--c", left: "58%", top: "84%", size: "82vmax", depth: 0.3, drift: 1.05 },
  { id: "d", variantClass: "sv-bg__orb--d", left: "74%", top: "56%", size: "52vmax", depth: 0.38, drift: 0.86 },
]

export function AuroraBackground() {
  const rootRef = useRef<HTMLDivElement | null>(null)

  const sparkIds = useMemo(() => Array.from({ length: 12 }, (_, i) => i), [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    gsap.registerPlugin(ScrollTrigger)
    ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true })

    const ctx = gsap.context(() => {
      const base = root.querySelector<HTMLElement>("[data-sv-bg='base']")
      const grid = root.querySelector<HTMLElement>("[data-sv-bg='grid']")
      const flareA = root.querySelector<HTMLElement>("[data-sv-bg='flare-a']")
      const flareB = root.querySelector<HTMLElement>("[data-sv-bg='flare-b']")

      const orbWraps = Array.from(root.querySelectorAll<HTMLElement>("[data-sv-orb-wrap]"))
      const orbs = Array.from(root.querySelectorAll<HTMLElement>("[data-sv-orb]"))
      const sparks = Array.from(root.querySelectorAll<HTMLElement>("[data-sv-spark]"))

      if (base) {
        gsap.set(base, { transformOrigin: "50% 50%" })
        gsap.to(base, {
          rotation: 5,
          xPercent: -1.5,
          yPercent: 1,
          duration: 34,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
          force3D: true,
        })
      }

      if (grid) {
        gsap.to(grid, {
          x: -90,
          y: 70,
          duration: 42,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
          force3D: true,
        })
      }

      if (flareA) {
        gsap.to(flareA, {
          xPercent: 18,
          duration: 26,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
          force3D: true,
        })
      }

      if (flareB) {
        gsap.to(flareB, {
          xPercent: -22,
          duration: 30,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
          force3D: true,
        })
      }

      for (const orb of orbs) {
        const drift = Number(orb.dataset.drift ?? 1)
        gsap.to(orb, {
          x: () => gsap.utils.random(-140, 140) * drift,
          y: () => gsap.utils.random(-120, 120) * drift,
          scale: () => gsap.utils.random(0.92, 1.14),
          rotation: () => gsap.utils.random(-10, 10),
          duration: () => gsap.utils.random(18, 30),
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          repeatRefresh: true,
          force3D: true,
          autoRound: false,
        })
      }

      const spawnSpark = (el: HTMLElement) => {
        const w = window.innerWidth
        const h = window.innerHeight

        const startX = gsap.utils.random(0, w)
        const startY = gsap.utils.random(h * 0.25, h * 1.05)
        const driftX = gsap.utils.random(-90, 90)
        const distanceY = gsap.utils.random(h * 0.45, h * 0.95)
        const duration = gsap.utils.random(9, 16)

        gsap.set(el, {
          x: startX,
          y: startY,
          opacity: gsap.utils.random(0.08, 0.22),
          scale: gsap.utils.random(0.65, 1.5),
          force3D: true,
        })

        gsap.to(el, {
          x: startX + driftX,
          y: startY - distanceY,
          opacity: 0,
          duration,
          ease: "none",
          onComplete: () => spawnSpark(el),
        })
      }

      sparks.forEach((spark, i) => {
        gsap.delayedCall(i * 0.35, () => spawnSpark(spark))
      })

      if (orbWraps.length) {
        for (const wrap of orbWraps) {
          const depth = Number(wrap.dataset.depth ?? 0.25)
          gsap.to(wrap, {
            y: -140 * depth,
            x: 90 * depth,
            ease: "none",
            scrollTrigger: {
              trigger: document.documentElement,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.85,
              invalidateOnRefresh: true,
              fastScrollEnd: true,
            },
          })
        }
      }
    }, root)

    return () => ctx.revert()
  }, [])

  return (
    <div ref={rootRef} className="sv-bg" aria-hidden="true">
      <div className="sv-bg__base" data-sv-bg="base" />
      <div className="sv-bg__grid" data-sv-bg="grid" />
      <div className="sv-bg__flare sv-bg__flare--a" data-sv-bg="flare-a" />
      <div className="sv-bg__flare sv-bg__flare--b" data-sv-bg="flare-b" />

      <div className="sv-bg__orbs">
        {ORBS.map((orb) => (
          <div
            key={orb.id}
            data-sv-orb-wrap
            data-depth={orb.depth}
            className="sv-bg__orb-wrap"
            style={{ left: orb.left, top: orb.top, width: orb.size, height: orb.size }}
          >
            <div data-sv-orb data-drift={orb.drift} className={`sv-bg__orb ${orb.variantClass}`} />
          </div>
        ))}
      </div>

      <div className="sv-bg__sparks" aria-hidden>
        {sparkIds.map((id) => (
          <div key={id} data-sv-spark className="sv-bg__spark" />
        ))}
      </div>

      <div className="sv-bg__vignette" />
    </div>
  )
}
