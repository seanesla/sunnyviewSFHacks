"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SunnyviewLogoLoader } from "@/components/SunnyviewLogoLoader"
import { useAccent } from "@/lib/accent-context"
import { cn } from "@/lib/utils"

type CesiumModule = typeof import("cesium")

function orbitAccentColors(Cesium: CesiumModule, hue: number, saturation: number) {
  const normalizedHue = ((((hue % 360) + 360) % 360) / 360)
  const normalizedSat = Math.max(0, Math.min(1, saturation * 3.6))
  const accent = Cesium.Color.fromHsl(normalizedHue, normalizedSat, 0.62)
  return {
    headColor: accent.withAlpha(0.98),
    trailCoreColor: accent.withAlpha(0.46),
    trailGlowColor: accent.withAlpha(0.16),
  }
}

function createOrbitParticleSprite(): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = 80
  canvas.height = 80
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas

  const center = canvas.width / 2
  const gradOuter = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradOuter.addColorStop(0, "rgba(255,255,255,1)")
  gradOuter.addColorStop(0.22, "rgba(255,255,255,0.95)")
  gradOuter.addColorStop(0.52, "rgba(255,255,255,0.42)")
  gradOuter.addColorStop(1, "rgba(255,255,255,0)")

  ctx.fillStyle = gradOuter
  ctx.beginPath()
  ctx.arc(center, center, center, 0, Math.PI * 2)
  ctx.fill()

  const gradCore = ctx.createRadialGradient(center, center, 0, center, center, center * 0.34)
  gradCore.addColorStop(0, "rgba(255,255,255,1)")
  gradCore.addColorStop(1, "rgba(255,255,255,0)")

  ctx.fillStyle = gradCore
  ctx.beginPath()
  ctx.arc(center, center, center * 0.36, 0, Math.PI * 2)
  ctx.fill()

  return canvas
}

function isFiniteCartesian3(value: import("cesium").Cartesian3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
}

export function GlobeView({
  lat,
  lng,
  className,
  showUi = true,
  interactive = true,
  onPrimaryClick,
  onPickLocation,
  frame = true,
  variant = "app",
  onReadyChange,
}: {
  lat: number | null
  lng: number | null
  className?: string
  showUi?: boolean
  interactive?: boolean
  onPrimaryClick?: () => void
  onPickLocation?: (p: { lat: number; lng: number }) => void
  frame?: boolean
  variant?: "app" | "hero"
  onReadyChange?: (ready: boolean) => void
}) {
  const isHero = variant === "hero"
  const { hue, saturation } = useAccent()
  const accentRef = useRef({ hue, saturation })
  accentRef.current.hue = hue
  accentRef.current.saturation = saturation
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<import("cesium").Viewer | null>(null)
  const cesiumRef = useRef<CesiumModule | null>(null)
  const markerEntityRef = useRef<import("cesium").Entity | null>(null)
  const pickHandlerRef = useRef<import("cesium").ScreenSpaceEventHandler | null>(null)
  const clickSpinRafRef = useRef<number | null>(null)
  const landingSpinRafRef = useRef<number | null>(null)
  const landingSpinLastNowRef = useRef<number | null>(null)
  const orbitBillboardCollectionRef = useRef<import("cesium").BillboardCollection | null>(null)
  const orbitHeadBillboardRef = useRef<import("cesium").Billboard | null>(null)
  const orbitSecondaryHeadBillboardRef = useRef<import("cesium").Billboard | null>(null)
  const orbitTrailCoreEntityRef = useRef<import("cesium").Entity | null>(null)
  const orbitSecondaryTrailCoreEntityRef = useRef<import("cesium").Entity | null>(null)
  const orbitTrailGlowEntityRef = useRef<import("cesium").Entity | null>(null)
  const orbitSecondaryTrailGlowEntityRef = useRef<import("cesium").Entity | null>(null)
  const orbitTrailGlowMaterialRef = useRef<import("cesium").PolylineGlowMaterialProperty | null>(null)
  const orbitSecondaryTrailGlowMaterialRef = useRef<import("cesium").PolylineGlowMaterialProperty | null>(null)
  const orbitTrailPositionsRef = useRef<import("cesium").Cartesian3[]>([])
  const orbitSecondaryTrailPositionsRef = useRef<import("cesium").Cartesian3[]>([])
  const orbitRafRef = useRef<number | null>(null)
  const orbitLastNowRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showLoader = !ready
  const landingActive = !interactive && Boolean(onPrimaryClick)
  const hasLocation = Number.isFinite(lat ?? NaN) && Number.isFinite(lng ?? NaN)
  const locationLabel = useMemo(() => {
    if (!hasLocation) return "No location yet"
    return `${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)}`
  }, [hasLocation, lat, lng])

  const clearLandingOrbit = useCallback((viewerArg?: import("cesium").Viewer | null) => {
    if (orbitRafRef.current !== null) {
      window.cancelAnimationFrame(orbitRafRef.current)
      orbitRafRef.current = null
    }
    orbitLastNowRef.current = null

    const billboardCollection = orbitBillboardCollectionRef.current
    orbitBillboardCollectionRef.current = null
    orbitHeadBillboardRef.current = null
    orbitSecondaryHeadBillboardRef.current = null

    const trailCoreEntity = orbitTrailCoreEntityRef.current
    orbitTrailCoreEntityRef.current = null
    const secondaryTrailCoreEntity = orbitSecondaryTrailCoreEntityRef.current
    orbitSecondaryTrailCoreEntityRef.current = null
    const trailGlowEntity = orbitTrailGlowEntityRef.current
    orbitTrailGlowEntityRef.current = null
    const secondaryTrailGlowEntity = orbitSecondaryTrailGlowEntityRef.current
    orbitSecondaryTrailGlowEntityRef.current = null
    orbitTrailGlowMaterialRef.current = null
    orbitSecondaryTrailGlowMaterialRef.current = null
    orbitTrailPositionsRef.current = []
    orbitSecondaryTrailPositionsRef.current = []

    const viewer = viewerArg ?? viewerRef.current
    if (!viewer) return

    if (billboardCollection) {
      try {
        viewer.scene.primitives.remove(billboardCollection)
      } catch {
        // ignore
      }
    }

    if (trailCoreEntity) {
      try {
        viewer.entities.remove(trailCoreEntity)
      } catch {
        // ignore
      }
    }

    if (secondaryTrailCoreEntity) {
      try {
        viewer.entities.remove(secondaryTrailCoreEntity)
      } catch {
        // ignore
      }
    }

    if (trailGlowEntity) {
      try {
        viewer.entities.remove(trailGlowEntity)
      } catch {
        // ignore
      }
    }

    if (secondaryTrailGlowEntity) {
      try {
        viewer.entities.remove(secondaryTrailGlowEntity)
      } catch {
        // ignore
      }
    }

    try {
      viewer.scene.requestRender()
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    let startupRaf: number | null = null
    let startupTimer: number | null = null
    let renderErrorListener: ((scene: unknown, error: unknown) => void) | null = null
    setReady(false)
    setError(null)
    onReadyChange?.(false)
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
        cesiumRef.current = Cesium
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
        renderErrorListener = (_scene, renderErr) => {
          if (cancelled) return

          const message = renderErr instanceof Error ? renderErr.message : String(renderErr ?? "")
          if (message.includes("normalized result is not a number")) {
            clearLandingOrbit(viewer)
            try {
              viewer.scene.requestRender()
            } catch {
              // ignore
            }
            return
          }

          if (message.length > 0) {
            setError(message)
          }
          onReadyChange?.(true)
        }
        try {
          viewer.scene.renderError.addEventListener(renderErrorListener)
        } catch {
          renderErrorListener = null
        }

        viewer.useBrowserRecommendedResolution = true
        if (isHero) {
          viewer.resolutionScale = 0.84
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
        onReadyChange?.(true)
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : "Failed to load Cesium."
        setError(msg)
        onReadyChange?.(true)
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
      if (pickHandlerRef.current) {
        try {
          pickHandlerRef.current.destroy()
        } catch {
          // ignore
        }
        pickHandlerRef.current = null
      }
      const v = viewerRef.current
      if (v && renderErrorListener) {
        try {
          v.scene.renderError.removeEventListener(renderErrorListener)
        } catch {
          // ignore
        }
      }
      renderErrorListener = null
      clearLandingOrbit(v)
      viewerRef.current = null
      markerEntityRef.current = null
      try {
        v?.destroy()
      } catch {
        // ignore
      }
    }
  }, [clearLandingOrbit, isHero, onReadyChange])

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

    if (!interactive || !onPickLocation) {
      if (pickHandlerRef.current) {
        try {
          pickHandlerRef.current.destroy()
        } catch {
          // ignore
        }
        pickHandlerRef.current = null
      }
      return
    }

    let cancelled = false
    ;(async () => {
      const Cesium: CesiumModule = cesiumRef.current ?? (await import("cesium"))
      cesiumRef.current = Cesium
      if (cancelled) return

      if (pickHandlerRef.current) {
        try {
          pickHandlerRef.current.destroy()
        } catch {
          // ignore
        }
        pickHandlerRef.current = null
      }

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
      pickHandlerRef.current = handler
      handler.setInputAction(
        (movement: any) => {
          const viewerNow = viewerRef.current
          const CesiumNow = cesiumRef.current
          if (!viewerNow || !CesiumNow) return
          const pos = movement?.position
          if (!pos) return
          const cartesian = viewerNow.camera.pickEllipsoid(pos, viewerNow.scene.globe.ellipsoid)
          if (!cartesian) return
          const cartographic = CesiumNow.Cartographic.fromCartesian(cartesian)
          const pickedLat = CesiumNow.Math.toDegrees(cartographic.latitude)
          const pickedLng = CesiumNow.Math.toDegrees(cartographic.longitude)
          if (!Number.isFinite(pickedLat) || !Number.isFinite(pickedLng)) return
          onPickLocation({ lat: pickedLat, lng: pickedLng })
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK
      )
    })()

    return () => {
      cancelled = true
      if (pickHandlerRef.current) {
        try {
          pickHandlerRef.current.destroy()
        } catch {
          // ignore
        }
        pickHandlerRef.current = null
      }
    }
  }, [interactive, onPickLocation, ready])

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

    const speedRadPerSec = isHero ? 0.011 : 0.03
    const delayMs = isHero ? 300 : 1050

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
  }, [isHero, landingActive, ready])

  useEffect(() => {
    if (!ready) return
    if (!isHero) return

    const viewer = viewerRef.current
    if (!viewer) return

    if (!landingActive) {
      clearLandingOrbit(viewer)
      return
    }

    if (orbitBillboardCollectionRef.current) return

    let cancelled = false

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false

    ;(async () => {
      const Cesium: CesiumModule = cesiumRef.current ?? (await import("cesium"))
      cesiumRef.current = Cesium
      if (cancelled) return

      const liveViewer = viewerRef.current
      if (!liveViewer) return

      const { hue: accentHue, saturation: accentSat } = accentRef.current
      const { headColor, trailCoreColor, trailGlowColor } = orbitAccentColors(Cesium, accentHue, accentSat)
      const sprite = createOrbitParticleSprite()

      const billboards = liveViewer.scene.primitives.add(new Cesium.BillboardCollection())
      orbitBillboardCollectionRef.current = billboards
      const orbitHead = billboards.add({
        image: sprite,
        color: headColor,
        scale: 0.8,
      })
      orbitHeadBillboardRef.current = orbitHead

      const ellipsoid = liveViewer.scene.globe.ellipsoid
      const orbitRadius = ellipsoid.maximumRadius * 1.06
      const orbitSecondaryRadius = ellipsoid.maximumRadius * 1.115
      const orbitPlaneTiltRad = Cesium.Math.toRadians(82)
      const orbitPlanePrecessionRadPerSec = Cesium.Math.toRadians(28)
      const trailPointCount = 36
      const speedRadPerSec = Cesium.Math.toRadians(96)
      const secondaryPhaseOffsetRad = Cesium.Math.PI
      const frameIntervalMs = 1000 / 26

      const orbitNormalScratch = new Cesium.Cartesian3()
      const orbitBasisUScratch = new Cesium.Cartesian3()
      const orbitBasisVScratch = new Cesium.Cartesian3()
      const orbitPrecessionDirScratch = new Cesium.Cartesian3()
      const axisScratch = new Cesium.Cartesian3()

      let angle = Cesium.Math.toRadians(18)
      let planePrecessionAngle = Cesium.Math.toRadians(20)

      const computeOrbitBasis = (precessionAngleRad: number) => {
        try {
          const viewerNow = viewerRef.current
          if (!viewerNow) return false

          const cameraPos = viewerNow.camera.positionWC
          if (!isFiniteCartesian3(cameraPos)) {
            return false
          }

          const cameraMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(cameraPos)
          if (!Number.isFinite(cameraMagnitudeSq) || cameraMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }

          Cesium.Cartesian3.normalize(cameraPos, orbitNormalScratch)
          if (!isFiniteCartesian3(orbitNormalScratch)) {
            return false
          }

          const axis =
            Math.abs(Cesium.Cartesian3.dot(orbitNormalScratch, Cesium.Cartesian3.UNIT_Z)) > 0.9
              ? Cesium.Cartesian3.UNIT_Y
              : Cesium.Cartesian3.UNIT_Z
          Cesium.Cartesian3.clone(axis, axisScratch)

          Cesium.Cartesian3.cross(axisScratch, orbitNormalScratch, orbitBasisUScratch)
          let basisUMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitBasisUScratch)
          if (!Number.isFinite(basisUMagnitudeSq) || basisUMagnitudeSq <= Cesium.Math.EPSILON12) {
            Cesium.Cartesian3.cross(Cesium.Cartesian3.UNIT_X, orbitNormalScratch, orbitBasisUScratch)
            basisUMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitBasisUScratch)
          }
          if (!Number.isFinite(basisUMagnitudeSq) || basisUMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }

          Cesium.Cartesian3.normalize(orbitBasisUScratch, orbitBasisUScratch)
          if (!isFiniteCartesian3(orbitBasisUScratch)) {
            return false
          }

          Cesium.Cartesian3.cross(orbitNormalScratch, orbitBasisUScratch, orbitBasisVScratch)
          const basisVMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitBasisVScratch)
          if (!Number.isFinite(basisVMagnitudeSq) || basisVMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }
          Cesium.Cartesian3.normalize(orbitBasisVScratch, orbitBasisVScratch)
          if (!isFiniteCartesian3(orbitBasisVScratch)) {
            return false
          }

          const precessionCos = Math.cos(precessionAngleRad)
          const precessionSin = Math.sin(precessionAngleRad)
          Cesium.Cartesian3.multiplyByScalar(orbitBasisUScratch, precessionCos, axisScratch)
          Cesium.Cartesian3.multiplyByScalar(orbitBasisVScratch, precessionSin, orbitPrecessionDirScratch)
          Cesium.Cartesian3.add(axisScratch, orbitPrecessionDirScratch, orbitPrecessionDirScratch)
          const precessionDirMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitPrecessionDirScratch)
          if (!Number.isFinite(precessionDirMagnitudeSq) || precessionDirMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }
          Cesium.Cartesian3.normalize(orbitPrecessionDirScratch, orbitPrecessionDirScratch)
          if (!isFiniteCartesian3(orbitPrecessionDirScratch)) {
            return false
          }

          const cosTilt = Math.cos(orbitPlaneTiltRad)
          const sinTilt = Math.sin(orbitPlaneTiltRad)
          Cesium.Cartesian3.multiplyByScalar(orbitNormalScratch, cosTilt, axisScratch)
          Cesium.Cartesian3.multiplyByScalar(orbitPrecessionDirScratch, sinTilt, orbitNormalScratch)
          Cesium.Cartesian3.add(axisScratch, orbitNormalScratch, orbitNormalScratch)
          const tiltedNormalMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitNormalScratch)
          if (!Number.isFinite(tiltedNormalMagnitudeSq) || tiltedNormalMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }
          Cesium.Cartesian3.normalize(orbitNormalScratch, orbitNormalScratch)
          if (!isFiniteCartesian3(orbitNormalScratch)) {
            return false
          }

          const projectedAmount = Cesium.Cartesian3.dot(orbitPrecessionDirScratch, orbitNormalScratch)
          Cesium.Cartesian3.multiplyByScalar(orbitNormalScratch, projectedAmount, axisScratch)
          Cesium.Cartesian3.subtract(orbitPrecessionDirScratch, axisScratch, orbitBasisUScratch)
          const finalBasisUMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitBasisUScratch)
          if (!Number.isFinite(finalBasisUMagnitudeSq) || finalBasisUMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }
          Cesium.Cartesian3.normalize(orbitBasisUScratch, orbitBasisUScratch)
          if (!isFiniteCartesian3(orbitBasisUScratch)) {
            return false
          }

          Cesium.Cartesian3.cross(orbitNormalScratch, orbitBasisUScratch, orbitBasisVScratch)
          const finalBasisVMagnitudeSq = Cesium.Cartesian3.magnitudeSquared(orbitBasisVScratch)
          if (!Number.isFinite(finalBasisVMagnitudeSq) || finalBasisVMagnitudeSq <= Cesium.Math.EPSILON12) {
            return false
          }

          Cesium.Cartesian3.normalize(orbitBasisVScratch, orbitBasisVScratch)
          return isFiniteCartesian3(orbitBasisVScratch)
        } catch {
          return false
        }
      }

      const orbitPoint = (a: number, radius: number) => {
        const cosA = Math.cos(a)
        const sinA = Math.sin(a)
        return new Cesium.Cartesian3(
          orbitBasisUScratch.x * cosA * radius +
            orbitBasisVScratch.x * sinA * radius,
          orbitBasisUScratch.y * cosA * radius +
            orbitBasisVScratch.y * sinA * radius,
          orbitBasisUScratch.z * cosA * radius +
            orbitBasisVScratch.z * sinA * radius
        )
      }

      if (!computeOrbitBasis(planePrecessionAngle)) {
        clearLandingOrbit(liveViewer)
        return
      }

      const initialHeadPosition = orbitPoint(angle, orbitRadius)
      if (!isFiniteCartesian3(initialHeadPosition)) {
        clearLandingOrbit(liveViewer)
        return
      }
      const initialSecondaryHeadPosition = orbitPoint(
        (angle + secondaryPhaseOffsetRad) % Cesium.Math.TWO_PI,
        orbitSecondaryRadius
      )
      if (!isFiniteCartesian3(initialSecondaryHeadPosition)) {
        clearLandingOrbit(liveViewer)
        return
      }
      orbitTrailPositionsRef.current = [initialHeadPosition, initialHeadPosition]
      orbitSecondaryTrailPositionsRef.current = [initialSecondaryHeadPosition, initialSecondaryHeadPosition]

      orbitHead.position = initialHeadPosition

      const orbitSecondaryHead = billboards.add({
        image: sprite,
        color: headColor.withAlpha(0.9),
        scale: 0.72,
      })
      orbitSecondaryHead.position = initialSecondaryHeadPosition
      orbitSecondaryHeadBillboardRef.current = orbitSecondaryHead

      const trailPositionsProperty = new Cesium.CallbackProperty(() => orbitTrailPositionsRef.current, false)
      const secondaryTrailPositionsProperty = new Cesium.CallbackProperty(
        () => orbitSecondaryTrailPositionsRef.current,
        false
      )

      const trailGlowMaterial = new Cesium.PolylineGlowMaterialProperty({
        color: trailGlowColor,
        glowPower: 0.22,
        taperPower: 0.78,
      })
      orbitTrailGlowMaterialRef.current = trailGlowMaterial
      const secondaryTrailGlowMaterial = new Cesium.PolylineGlowMaterialProperty({
        color: trailGlowColor.withAlpha(0.11),
        glowPower: 0.2,
        taperPower: 0.72,
      })
      orbitSecondaryTrailGlowMaterialRef.current = secondaryTrailGlowMaterial

      orbitTrailGlowEntityRef.current = liveViewer.entities.add({
        polyline: {
          positions: trailPositionsProperty,
          width: 14,
          material: trailGlowMaterial,
        },
      })

      orbitTrailCoreEntityRef.current = liveViewer.entities.add({
        polyline: {
          positions: trailPositionsProperty,
          width: 4,
          material: trailCoreColor,
        },
      })

      orbitSecondaryTrailGlowEntityRef.current = liveViewer.entities.add({
        polyline: {
          positions: secondaryTrailPositionsProperty,
          width: 11,
          material: secondaryTrailGlowMaterial,
        },
      })

      orbitSecondaryTrailCoreEntityRef.current = liveViewer.entities.add({
        polyline: {
          positions: secondaryTrailPositionsProperty,
          width: 3,
          material: trailCoreColor.withAlpha(0.38),
        },
      })

      const drawFrame = (now: number, advance: boolean) => {
        const viewerNow = viewerRef.current
        const headNow = orbitHeadBillboardRef.current
        const secondaryHeadNow = orbitSecondaryHeadBillboardRef.current
        if (!viewerNow || !headNow || !secondaryHeadNow) return false

        const lastNow = orbitLastNowRef.current ?? now
        const dt = Math.min(0.05, (now - lastNow) / 1000)
        orbitLastNowRef.current = now

        if (advance) {
          angle = (angle + speedRadPerSec * dt) % Cesium.Math.TWO_PI
          planePrecessionAngle = (planePrecessionAngle + orbitPlanePrecessionRadPerSec * dt) % Cesium.Math.TWO_PI
        }

        if (!computeOrbitBasis(planePrecessionAngle)) return false

        const headPosition = orbitPoint(angle, orbitRadius)
        const secondaryHeadPosition = orbitPoint(
          (angle + secondaryPhaseOffsetRad) % Cesium.Math.TWO_PI,
          orbitSecondaryRadius
        )
        if (!isFiniteCartesian3(headPosition) || !isFiniteCartesian3(secondaryHeadPosition)) return false

        headNow.position = headPosition
        secondaryHeadNow.position = secondaryHeadPosition
        headNow.scale = 0.76 + Math.sin(now * 0.0044) * 0.08
        secondaryHeadNow.scale = 0.68 + Math.sin(now * 0.0038 + 1.4) * 0.06

        const prevTrail = orbitTrailPositionsRef.current
        const nextTrail: import("cesium").Cartesian3[] = [headPosition]
        const carryCount = Math.min(trailPointCount - 1, prevTrail.length)
        for (let i = 0; i < carryCount; i += 1) {
          const point = prevTrail[i]
          if (!isFiniteCartesian3(point)) return false
          nextTrail.push(point)
        }
        if (nextTrail.length < 2) {
          nextTrail.push(headPosition)
        }
        orbitTrailPositionsRef.current = nextTrail

        const prevSecondaryTrail = orbitSecondaryTrailPositionsRef.current
        const nextSecondaryTrail: import("cesium").Cartesian3[] = [secondaryHeadPosition]
        const secondaryCarryCount = Math.min(trailPointCount - 1, prevSecondaryTrail.length)
        for (let i = 0; i < secondaryCarryCount; i += 1) {
          const point = prevSecondaryTrail[i]
          if (!isFiniteCartesian3(point)) return false
          nextSecondaryTrail.push(point)
        }
        if (nextSecondaryTrail.length < 2) {
          nextSecondaryTrail.push(secondaryHeadPosition)
        }
        orbitSecondaryTrailPositionsRef.current = nextSecondaryTrail

        viewerNow.scene.requestRender()
        return true
      }

      if (reduceMotion) {
        const rendered = drawFrame(performance.now(), false)
        if (!rendered) {
          clearLandingOrbit(liveViewer)
        }
        return
      }

      const tick = (now: number) => {
        if (cancelled) return

        const lastNow = orbitLastNowRef.current
        if (lastNow !== null && now - lastNow < frameIntervalMs) {
          orbitRafRef.current = window.requestAnimationFrame(tick)
          return
        }

        const rendered = drawFrame(now, true)
        if (!rendered) {
          clearLandingOrbit()
          return
        }
        orbitRafRef.current = window.requestAnimationFrame(tick)
      }

      orbitLastNowRef.current = null
      orbitRafRef.current = window.requestAnimationFrame(tick)
    })()

    return () => {
      cancelled = true
      clearLandingOrbit()
    }
  }, [clearLandingOrbit, isHero, landingActive, ready])

  useEffect(() => {
    if (!ready) return
    if (!isHero) return

    const Cesium = cesiumRef.current
    if (!Cesium) return

    const orbitHead = orbitHeadBillboardRef.current
    const orbitSecondaryHead = orbitSecondaryHeadBillboardRef.current
    const trailCoreEntity = orbitTrailCoreEntityRef.current
    const secondaryTrailCoreEntity = orbitSecondaryTrailCoreEntityRef.current
    const trailGlowMaterial = orbitTrailGlowMaterialRef.current
    const secondaryTrailGlowMaterial = orbitSecondaryTrailGlowMaterialRef.current
    const trailGlowEntity = orbitTrailGlowEntityRef.current
    const secondaryTrailGlowEntity = orbitSecondaryTrailGlowEntityRef.current
    if (
      !orbitHead &&
      !orbitSecondaryHead &&
      !trailCoreEntity &&
      !secondaryTrailCoreEntity &&
      !trailGlowMaterial &&
      !secondaryTrailGlowMaterial &&
      !trailGlowEntity &&
      !secondaryTrailGlowEntity
    ) {
      return
    }

    const { headColor, trailCoreColor, trailGlowColor } = orbitAccentColors(Cesium, hue, saturation)

    if (orbitHead) {
      orbitHead.color = headColor
    }

    if (orbitSecondaryHead) {
      orbitSecondaryHead.color = headColor.withAlpha(0.9)
    }

    const corePolyline = trailCoreEntity?.polyline
    if (corePolyline) {
      ;(corePolyline as any).material = trailCoreColor
    }

    const secondaryCorePolyline = secondaryTrailCoreEntity?.polyline
    if (secondaryCorePolyline) {
      ;(secondaryCorePolyline as any).material = trailCoreColor.withAlpha(0.38)
    }

    if (trailGlowMaterial) {
      ;(trailGlowMaterial as any).color = trailGlowColor
    } else if (trailGlowEntity?.polyline) {
      ;(trailGlowEntity.polyline as any).material = new Cesium.PolylineGlowMaterialProperty({
        color: trailGlowColor,
        glowPower: 0.22,
        taperPower: 0.78,
      })
    }

    const secondaryTrailGlowColor = trailGlowColor.withAlpha(0.11)
    if (secondaryTrailGlowMaterial) {
      ;(secondaryTrailGlowMaterial as any).color = secondaryTrailGlowColor
    } else if (secondaryTrailGlowEntity?.polyline) {
      ;(secondaryTrailGlowEntity.polyline as any).material = new Cesium.PolylineGlowMaterialProperty({
        color: secondaryTrailGlowColor,
        glowPower: 0.2,
        taperPower: 0.72,
      })
    }

    const viewer = viewerRef.current
    if (viewer) {
      try {
        viewer.scene.requestRender()
      } catch {
        // ignore
      }
    }
  }, [hue, isHero, ready, saturation])

  useEffect(() => {
    if (!ready) return
    if (!hasLocation) return
    ;(async () => {
      const Cesium: CesiumModule = await import("cesium")
      const viewer = viewerRef.current
      if (!viewer) return

      const position = Cesium.Cartesian3.fromDegrees(lng as number, lat as number, 0)
      if (!markerEntityRef.current) {
        markerEntityRef.current = viewer.entities.add({
          position,
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString("#ffd166"),
            outlineColor: Cesium.Color.fromCssColorString("#0b0f19"),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
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
      {showLoader && !error && (
        <div
          className={cn(
            "absolute inset-0 z-10 grid place-items-center overflow-hidden",
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
