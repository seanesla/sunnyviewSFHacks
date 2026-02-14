"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { SunnyviewLogoLoader } from "@/components/SunnyviewLogoLoader"
import { cn } from "@/lib/utils"

type CesiumModule = typeof import("cesium")

export function GlobeView({
  lat,
  lng,
  className,
  showUi = true,
  interactive = true,
  onPrimaryClick,
  frame = true,
  variant = "app",
}: {
  lat: number | null
  lng: number | null
  className?: string
  showUi?: boolean
  interactive?: boolean
  onPrimaryClick?: () => void
  frame?: boolean
  variant?: "app" | "hero"
}) {
  const isHero = variant === "hero"
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<import("cesium").Viewer | null>(null)
  const markerEntityRef = useRef<import("cesium").Entity | null>(null)
  const clickSpinRafRef = useRef<number | null>(null)
  const landingSpinRafRef = useRef<number | null>(null)
  const landingSpinLastNowRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showLoader = !ready
  const landingActive = !interactive && Boolean(onPrimaryClick)
  const hasLocation = Number.isFinite(lat ?? NaN) && Number.isFinite(lng ?? NaN)
  const locationLabel = useMemo(() => {
    if (!hasLocation) return "No location yet"
    return `${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)}`
  }, [hasLocation, lat, lng])

  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    let startupRaf: number | null = null
    let startupTimer: number | null = null
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        await new Promise<void>((resolve) => {
          startupRaf = window.requestAnimationFrame(() => {
            startupRaf = null
            resolve()
          })
        })
        if (cancelled) return

        await new Promise<void>((resolve) => {
          startupTimer = window.setTimeout(() => {
            startupTimer = null
            resolve()
          }, 60)
        })
        if (cancelled) return

        const Cesium: CesiumModule = await import("cesium")
        if (cancelled) return

        // Next.js: CopyWebpackPlugin outputs to `/_next/static/cesium/*` (Workers, Assets, Widgets).
        ;(globalThis as any).CESIUM_BASE_URL = "/_next/static/cesium"

        const token = (process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "").trim()
        // Cesium ion imagery shows ion branding + data attributions.
        // For the landing/hero globe we avoid ion imagery entirely.
        const useIonImagery = Boolean(token) && !isHero
        if (useIonImagery) {
          Cesium.Ion.defaultAccessToken = token
        }

        const el = containerRef.current
        if (!el) return

        const viewer = new Cesium.Viewer(el, {
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          baseLayer: false,
          geocoder: false,
          sceneModePicker: false,
          homeButton: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          shouldAnimate: false,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          scene3DOnly: true,
          contextOptions: isHero ? ({ webgl: { alpha: true } } as any) : undefined,
        })

        viewerRef.current = viewer
        viewer.useBrowserRecommendedResolution = true
        if (isHero) {
          viewer.resolutionScale = 0.9
        }

        if (isHero) {
          viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT
          viewer.scene.fog.enabled = false
          if (viewer.scene.skyBox) viewer.scene.skyBox.show = false
          if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
          if (viewer.scene.sun) viewer.scene.sun.show = false
          if (viewer.scene.moon) viewer.scene.moon.show = false
          viewer.scene.globe.enableLighting = false
          viewer.scene.globe.showGroundAtmosphere = false
        } else {
          viewer.scene.globe.enableLighting = true
          if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true
          viewer.scene.fog.enabled = true
        }

        // Imagery:
        // - App: prefer ion if token is present.
        // - Hero: always use Esri (keeps branding off the landing page).
        viewer.imageryLayers.removeAll()
        const loadImagery = async () => {
          try {
            const provider = useIonImagery
              ? await Cesium.createWorldImageryAsync()
              : await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
                )
            if (cancelled) return
            const liveViewer = viewerRef.current
            if (!liveViewer) return
            liveViewer.imageryLayers.removeAll()
            liveViewer.imageryLayers.addImageryProvider(provider)
            liveViewer.scene.requestRender()
          } catch {
            // If imagery fails to load, keep the globe untextured.
          }
        }
        await loadImagery()
        if (cancelled) return

        await new Promise<void>((resolve) => {
          const liveViewer = viewerRef.current
          if (!liveViewer) {
            resolve()
            return
          }

          const globe = liveViewer.scene.globe
          let done = false
          let tileTimeout = 0
          let checkRaf: number | null = null

          const finish = () => {
            if (done) return
            done = true
            try {
              globe.tileLoadProgressEvent.removeEventListener(onTileProgress)
            } catch {
              // ignore
            }
            window.clearTimeout(tileTimeout)
            if (checkRaf !== null) {
              window.cancelAnimationFrame(checkRaf)
              checkRaf = null
            }
            resolve()
          }

          const onTileProgress = (remainingTiles: number) => {
            if (remainingTiles === 0) {
              finish()
            }
          }

          try {
            globe.tileLoadProgressEvent.addEventListener(onTileProgress)
          } catch {
            resolve()
            return
          }

          tileTimeout = window.setTimeout(finish, 9000)

          checkRaf = window.requestAnimationFrame(() => {
            checkRaf = null
            if (globe.tilesLoaded) {
              finish()
              return
            }
            try {
              liveViewer.scene.requestRender()
            } catch {
              finish()
            }
          })
        })
        if (cancelled) return

        ro = new ResizeObserver(() => {
          try {
            viewer.resize()
            viewer.scene.requestRender()
          } catch {
            // ignore
          }
        })
        try {
          ro.observe(el)
        } catch {
          // ignore
        }

        setReady(true)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load Cesium."
        setError(msg)
      }
    })()

    return () => {
      cancelled = true
      try {
        ro?.disconnect()
      } catch {
        // ignore
      }
      ro = null
      if (startupRaf !== null) {
        window.cancelAnimationFrame(startupRaf)
        startupRaf = null
      }
      if (startupTimer !== null) {
        window.clearTimeout(startupTimer)
        startupTimer = null
      }
      if (clickSpinRafRef.current !== null) {
        window.cancelAnimationFrame(clickSpinRafRef.current)
        clickSpinRafRef.current = null
      }
      if (landingSpinRafRef.current !== null) {
        window.cancelAnimationFrame(landingSpinRafRef.current)
        landingSpinRafRef.current = null
        landingSpinLastNowRef.current = null
      }
      const v = viewerRef.current
      viewerRef.current = null
      markerEntityRef.current = null
      try {
        v?.destroy()
      } catch {
        // ignore
      }
    }
  }, [isHero])

  useEffect(() => {
    if (!ready) return
    const viewer = viewerRef.current
    if (!viewer) return
    const c = viewer.scene.screenSpaceCameraController
    c.enableInputs = interactive
    c.enableRotate = interactive
    c.enableTranslate = interactive
    c.enableZoom = interactive
    c.enableTilt = interactive
    c.enableLook = interactive
  }, [interactive, ready])

  useEffect(() => {
    if (!ready) return
    const viewer = viewerRef.current
    if (!viewer) return

    if (landingSpinRafRef.current !== null) {
      window.cancelAnimationFrame(landingSpinRafRef.current)
      landingSpinRafRef.current = null
      landingSpinLastNowRef.current = null
    }

    if (!landingActive) return

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    try {
      viewer.camera.flyHome(reduceMotion ? 0 : 1)
    } catch {
      // ignore
    }

    if (reduceMotion) return

    const speedRadPerSec = 0.03
    const delayMs = 1050

    const tick = (now: number) => {
      const viewerNow = viewerRef.current
      if (!viewerNow) return
      const lastNow = landingSpinLastNowRef.current ?? now
      const dt = Math.min(0.05, (now - lastNow) / 1000)
      landingSpinLastNowRef.current = now
      try {
        viewerNow.camera.rotateRight(speedRadPerSec * dt)
        viewerNow.scene.requestRender()
      } catch {
        return
      }
      landingSpinRafRef.current = window.requestAnimationFrame(tick)
    }

    const startTimer = window.setTimeout(() => {
      landingSpinLastNowRef.current = null
      landingSpinRafRef.current = window.requestAnimationFrame(tick)
    }, delayMs)

    return () => {
      window.clearTimeout(startTimer)
      if (landingSpinRafRef.current !== null) {
        window.cancelAnimationFrame(landingSpinRafRef.current)
        landingSpinRafRef.current = null
      }
      landingSpinLastNowRef.current = null
    }
  }, [landingActive, ready])

  useEffect(() => {
    if (!ready) return
    if (!hasLocation) return
    ;(async () => {
      const Cesium: CesiumModule = await import("cesium")
      const viewer = viewerRef.current
      if (!viewer) return

      const position = Cesium.Cartesian3.fromDegrees(lng as number, lat as number, 20)
      if (!markerEntityRef.current) {
        markerEntityRef.current = viewer.entities.add({
          position,
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString("#ffd166"),
            outlineColor: Cesium.Color.fromCssColorString("#0b0f19"),
            outlineWidth: 2,
          },
          label: {
            text: "Site",
            font: "14px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
          },
        })
      } else {
        markerEntityRef.current.position = position as any
      }
      viewer.scene.requestRender()
    })()
  }, [ready, hasLocation, lat, lng])

  async function centerAndSpin() {
    const viewer = viewerRef.current
    if (!viewer) return

    try {
      viewer.camera.flyHome(0.85)
    } catch {
      // ignore
    }

    if (landingSpinRafRef.current !== null) {
      window.cancelAnimationFrame(landingSpinRafRef.current)
      landingSpinRafRef.current = null
      landingSpinLastNowRef.current = null
    }

    if (clickSpinRafRef.current !== null) {
      window.cancelAnimationFrame(clickSpinRafRef.current)
      clickSpinRafRef.current = null
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
    if (reduceMotion) return

    const start = performance.now()
    let lastNow = start
    const delayMs = 90
    const durationMs = 1220
    const maxRadPerSec = 0.95

    const tick = (now: number) => {
      const viewerNow = viewerRef.current
      if (!viewerNow) return

      const elapsed = now - start
      if (elapsed < delayMs) {
        lastNow = now
        clickSpinRafRef.current = window.requestAnimationFrame(tick)
        return
      }
      const t = Math.min(1, (elapsed - delayMs) / durationMs)
      const velocity = maxRadPerSec * Math.sin(Math.PI * t)
      const dt = Math.min(0.05, (now - lastNow) / 1000)
      lastNow = now
      viewerNow.camera.rotateRight(velocity * dt)
      viewerNow.scene.requestRender()

      if (t >= 1) {
        clickSpinRafRef.current = null
        return
      }
      clickSpinRafRef.current = window.requestAnimationFrame(tick)
    }

    clickSpinRafRef.current = window.requestAnimationFrame(tick)
  }

  async function flyTo() {
    if (!hasLocation) return
    const Cesium: CesiumModule = await import("cesium")
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng as number, lat as number, 1200),
      duration: 1.9,
    })
  }

  useEffect(() => {
    if (!ready) return
    if (!interactive) return
    if (!hasLocation) return
    void flyTo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, interactive, hasLocation, lat, lng])

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden",
        isHero && "globe-hero",
        frame && "rounded-xl border border-border bg-card",
        className
      )}
    >
      {!error && (
        <div
          className={cn(
            "absolute inset-0 z-10 grid place-items-center overflow-hidden transition-opacity duration-200 ease-out motion-reduce:duration-0",
            showLoader ? "opacity-100" : "pointer-events-none opacity-0",
            isHero ? "bg-transparent" : "bg-gradient-to-b from-black/10 via-black/20 to-black/40"
          )}
        >
          {isHero ? (
            <div className="absolute inset-0 bg-black" aria-hidden />
          ) : null}

          <SunnyviewLogoLoader className="relative z-[1]" />
        </div>
      )}

      {showUi && (
        <div className="absolute left-3 top-3 z-20 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <div className="font-medium text-foreground">3D Earth</div>
          <div className="mt-0.5">{locationLabel}</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={flyTo}
              disabled={!hasLocation}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Fly to location
            </button>
            <div className="text-[11px] text-muted-foreground">
              {variant !== "hero" && process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN?.trim()
                ? "Cesium ion imagery"
                : "Esri World Imagery"}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 grid place-items-center p-6 text-center">
          <div className="rounded-lg border border-border bg-background/80 p-4 text-sm text-muted-foreground backdrop-blur">
            <div className="font-medium text-foreground">Globe failed to load</div>
            <div className="mt-1">{error}</div>
          </div>
        </div>
      )}

      {onPrimaryClick && !interactive && !error && (
        <button
          type="button"
          aria-label="Start"
          className="absolute inset-0 z-30 cursor-pointer bg-transparent"
          onClick={() => {
            void centerAndSpin()
            onPrimaryClick()
          }}
        />
      )}

      <div
        ref={containerRef}
        className={`absolute inset-0 transition-opacity duration-700 motion-reduce:duration-0 ${ready && !error ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  )
}
