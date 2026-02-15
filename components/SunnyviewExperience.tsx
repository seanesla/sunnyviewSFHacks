"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, History, Settings2 } from "lucide-react";
import { gsap } from "gsap";
import { HeroSection } from "@/components/hero-section";
import { HistorySheet } from "@/components/history-sheet";
import { GlobeStage } from "@/components/GlobeStage";
import { MapInput, type MapInputResult } from "@/components/MapInput";
import { SunnyviewLogoLoader } from "@/components/SunnyviewLogoLoader";
import { SettingsPage } from "@/components/settings-page";
import { SolarForecastCard } from "@/components/SolarForecastCard";
import type { PanelSpec, PlacedPanel, Point } from "@/components/PanelPacking";
import { packPanelsDeterministic } from "@/components/PanelPacking";
import { RoofCanvas } from "@/components/RoofCanvas";
import { BackgroundScene } from "@/components/BackgroundScene";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiOrigin, apiUrl } from "@/lib/api";
import { saveHistory } from "@/lib/history-api";
import type { HistorySnapshot, HistorySummary } from "@/lib/history-types";
import { buildStaticMapSpec } from "@/lib/static-map";
import { PANEL_OPTIONS } from "@/lib/panels";
import { polygonAreaPx2 } from "@/lib/roof-plane";
import { cn } from "@/lib/utils";

type Phase = "landing" | "opening" | "app";

type Estimate = {
  annualKwh: number;
  monthlyKwh: number[];
  annualCo2Kg: number;
  source: "fallback" | "server";
  assumptions?: unknown;
};

type CandidatePolygon = {
  id: string;
  polygon: Point[];
  score?: number;
};

function coerceNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function clampAngle90(deg: number) {
  let d = deg;
  while (d > 90) d -= 180;
  while (d < -90) d += 180;
  return d;
}

function normAxis90(deg: number) {
  let d = deg % 90;
  if (d < 0) d += 90;
  // keep inside [0, 90)
  if (d >= 90) d -= 90;
  return d;
}

function polygonDominantEdgeAxisDeg(poly: Point[]) {
  if (poly.length < 3) return 0;

  let sumCos = 0;
  let sumSin = 0;
  let wSum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 4)) continue;
    const angDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const axisDeg = normAxis90(angDeg);
    const r = (axisDeg * Math.PI) / 180;
    // Period = 90deg -> use 4x angle for circular mean.
    sumCos += len * Math.cos(4 * r);
    sumSin += len * Math.sin(4 * r);
    wSum += len;
  }

  if (!(wSum > 0) || (!Number.isFinite(sumCos) && !Number.isFinite(sumSin))) return 0;
  const mean = Math.atan2(sumSin, sumCos) / 4;
  const meanDeg = (mean * 180) / Math.PI;
  return normAxis90(meanDeg);
}

function bestRoofAlignedPackingOrientationDeg(opts: {
  polygon: Point[];
  mPerPx: number;
  panelSpec: PanelSpec;
  axisDeg: number;
}) {
  const axis = normAxis90(opts.axisDeg);
  const bases = [clampAngle90(axis), clampAngle90(axis + 90)];
  const offsets = [-2, -1, 0, 1, 2];
  const panel = { widthM: opts.panelSpec.widthM, heightM: opts.panelSpec.heightM, gapM: opts.panelSpec.gapM };

  let bestDeg = bases[0];
  let bestCount = -Infinity;
  let bestOffsetAbs = Infinity;
  for (const base of bases) {
    for (const off of offsets) {
      const deg = clampAngle90(base + off);
      const count = packPanelsDeterministic({
        usablePolygon: opts.polygon,
        mPerPx: opts.mPerPx,
        panel,
        orientationDeg: deg,
      }).length;
      const offAbs = Math.abs(off);
      if (count > bestCount || (count === bestCount && offAbs < bestOffsetAbs)) {
        bestCount = count;
        bestDeg = deg;
        bestOffsetAbs = offAbs;
      }
    }
  }
  return bestDeg;
}

// (legacy) wide-sweep orientation search removed in favor of roof-aligned packing.

function normalizePolygon(data: unknown, w: number, h: number): Point[] | null {
  const scaleIfNormalized = (pts: Point[]) => {
    const normalized = pts.every(
      (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1,
    );
    return normalized ? pts.map((p) => ({ x: p.x * w, y: p.y * h })) : pts;
  };

  const parsePointsArray = (arr: unknown[]): Point[] | null => {
    const pts: Point[] = [];
    for (const item of arr) {
      if (Array.isArray(item) && item.length >= 2) {
        const x = coerceNumber(item[0]);
        const y = coerceNumber(item[1]);
        if (x === null || y === null) return null;
        pts.push({ x, y });
        continue;
      }
      if (item && typeof item === "object") {
        const x = coerceNumber((item as any).x);
        const y = coerceNumber((item as any).y);
        if (x === null || y === null) return null;
        pts.push({ x, y });
        continue;
      }
      return null;
    }

    if (pts.length >= 2) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) pts.pop();
    }

    return pts.length >= 3 ? pts : null;
  };

  // GeoJSON-like shapes: Polygon / MultiPolygon / Feature.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as any;
    if (obj?.type === "Feature" && obj?.geometry) {
      return normalizePolygon(obj.geometry, w, h);
    }

    const typ = typeof obj?.type === "string" ? String(obj.type) : null;
    const coords = obj?.coordinates;
    if (coords && Array.isArray(coords)) {
      let ring: unknown[] | null = null;
      if (typ === "Polygon" && Array.isArray(coords[0])) {
        ring = coords[0] as unknown[];
      } else if (typ === "MultiPolygon" && Array.isArray(coords[0]) && Array.isArray((coords[0] as any)[0])) {
        ring = (coords[0] as any)[0] as unknown[];
      } else if (Array.isArray(coords[0]) && (coords[0] as any).length >= 2) {
        // Some services omit `type` and return { coordinates: [[x,y],...] }
        ring = coords as unknown[];
      }

      if (ring) {
        const pts = parsePointsArray(ring);
        return pts ? scaleIfNormalized(pts) : null;
      }
    }

    // Common wrappers.
    const inner = obj?.roofPolygon ?? obj?.polygon ?? obj?.usablePolygon;
    if (inner && inner !== data) {
      const pts = normalizePolygon(inner, w, h);
      if (pts) return pts;
    }
  }

  if (!Array.isArray(data)) return null;
  const pts = parsePointsArray(data);
  return pts ? scaleIfNormalized(pts) : null;
}

function roundHistory(n: number, digits: number) {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function historySaveSignature(snapshot: HistorySnapshot, summary: HistorySummary) {
  const basis = {
    lat: roundHistory(snapshot.lat, 6),
    lng: roundHistory(snapshot.lng, 6),
    zoom: Math.round(snapshot.zoom),
    panelSpec: {
      widthM: roundHistory(snapshot.panelSpec.widthM, 3),
      heightM: roundHistory(snapshot.panelSpec.heightM, 3),
      wattW: roundHistory(snapshot.panelSpec.wattW, 1),
      gapM: roundHistory(snapshot.panelSpec.gapM, 3),
    },
    orientationDeg: roundHistory(snapshot.layoutSummary.orientationDeg, 1),
    panelCount: snapshot.layoutSummary.panelCount,
    annualKwh: summary.annualKwh !== null ? Math.round(summary.annualKwh) : null,
    vertices: snapshot.geometry.vertices.map((p) => [roundHistory(p.x, 1), roundHistory(p.y, 1)]),
  };
  return JSON.stringify(basis);
}

function historySummaryFromSnapshot(snapshot: HistorySnapshot): HistorySummary {
  return {
    address: snapshot.address,
    panelCount: snapshot.layoutSummary.panelCount,
    dcKw: snapshot.layoutSummary.dcKw,
    annualKwh: snapshot.estimate ? snapshot.estimate.annualKwh : null,
    annualCo2Kg: snapshot.estimate ? snapshot.estimate.annualCo2Kg : null,
    lat: snapshot.lat,
    lng: snapshot.lng,
  };
}


export function SunnyviewExperience() {
  const hasBackend = apiOrigin().length > 0;
  const isMobile = useIsMobile();
  const [phase, setPhase] = useState<Phase>("landing");
  const [entered, setEntered] = useState(false);
  const [startupMinElapsed, setStartupMinElapsed] = useState(false);
  const [globeBootReady, setGlobeBootReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const opened = phase !== "landing";
  const opening = phase === "opening";
  const globeInteractive = phase === "app" && !settingsOpen;
  const startupDone = startupMinElapsed && globeBootReady;
  const [panelsMounted, setPanelsMounted] = useState(false);
  const [mobilePane, setMobilePane] = useState<"setup" | "results">("setup");
  const topChromeRef = useRef<HTMLDivElement | null>(null);
  const topIntroPlayedRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastHistorySigRef = useRef<string | null>(null);

  useEffect(() => {
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const t = window.setTimeout(() => setStartupMinElapsed(true), reduceMotion ? 0 : 1050);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!startupDone) return;
    const t = window.setTimeout(() => setEntered(true), 30);
    return () => window.clearTimeout(t);
  }, [startupDone]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (phase !== "landing") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== "app") return;

    setPanelsMounted(true);
    setEntered(true);
    setPhase("app");

    params.delete("view");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [phase]);

  useEffect(() => {
    if (!startupDone || settingsOpen || topIntroPlayedRef.current) return;

    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (reduceMotion) {
      topIntroPlayedRef.current = true;
      return;
    }

    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    if (topChromeRef.current) {
      tl.fromTo(
        topChromeRef.current,
        { y: -14, opacity: 0, scale: 0.985 },
        { y: 0, opacity: 1, scale: 1, duration: 0.46 },
        0,
      );
    }

    topIntroPlayedRef.current = true;

    return () => {
      tl.kill();
    };
  }, [opened, settingsOpen, startupDone]);

  function openApp() {
    if (phase !== "landing") return;
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    setPhase("opening");
    window.setTimeout(() => setPanelsMounted(true), reduceMotion ? 0 : 90);
    window.setTimeout(() => setPhase("app"), reduceMotion ? 0 : 380);
  }

  const [mapInput, setMapInput] = useState<MapInputResult>({
    kind: "address",
    address: "",
    lat: null,
    lng: null,
    zoom: 19,
    mPerPx: null,
  });

  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(19);

  const reverseGeocodeAbortRef = useRef<AbortController | null>(null);
  const pickEnabled = panelsMounted && globeInteractive && mapInput.kind === "address";
  const handlePickLocation = useCallback(
    (p: { lat: number; lng: number }) => {
      if (!pickEnabled) return;
      const nextLat = p.lat;
      const nextLng = p.lng;

      setLat(nextLat);
      setLng(nextLng);

      setMapInput((prev) => {
        if (prev.kind !== "address") return prev;
        return {
          ...prev,
          lat: nextLat,
          lng: nextLng,
          address: "",
          mPerPx: null,
        };
      });

      reverseGeocodeAbortRef.current?.abort();
      const ac = new AbortController();
      reverseGeocodeAbortRef.current = ac;

      void (async () => {
        try {
          const res = await fetch(
            apiUrl(`/api/reverse-geocode?lat=${encodeURIComponent(nextLat)}&lng=${encodeURIComponent(nextLng)}`),
            {
              method: "GET",
              headers: { accept: "application/json" },
              signal: ac.signal,
            },
          );
          if (!res.ok) return;
          const data = (await res.json().catch(() => null)) as any;
          const displayName = typeof data?.displayName === "string" ? data.displayName.trim() : "";
          if (!displayName) return;
          setMapInput((prev) => {
            if (prev.kind !== "address") return prev;
            if (prev.lat !== nextLat || prev.lng !== nextLng) return prev;
            if ((prev.address ?? "").trim().length > 0) return prev;
            return { ...prev, address: displayName };
          });
        } catch {
          // ignore
        }
      })();
    },
    [pickEnabled],
  );

  useEffect(() => {
    if (!panelsMounted) return;
    if (mapInput.kind !== "address") return;
    if (mapInput.lat === null || mapInput.lng === null) {
      setLat(null);
      setLng(null);
      return;
    }
    setLat(mapInput.lat);
    setLng(mapInput.lng);
    setZoom(mapInput.zoom ?? 19);
  }, [mapInput, panelsMounted]);

  useEffect(() => {
    if (!panelsMounted) return;
    if (mapInput.kind !== "address") return;
    if (mapInput.zoom === null) return;
    setZoom(mapInput.zoom);
  }, [mapInput.kind, mapInput.zoom, panelsMounted]);

  const mPerPx = mapInput.mPerPx;

  const addressStatic = useMemo(() => {
    if (mapInput.kind !== "address") return null;
    if (mapInput.lat === null || mapInput.lng === null) return null;
    const spec = buildStaticMapSpec({
      lat: mapInput.lat,
      lng: mapInput.lng,
      zoom: mapInput.zoom ?? 19,
    });
    return {
      ...spec,
      address: mapInput.address?.trim() ? mapInput.address.trim() : null,
    };
  }, [mapInput.address, mapInput.kind, mapInput.lat, mapInput.lng, mapInput.zoom]);

  const [panelSpec, setPanelSpec] = useState<PanelSpec>({
    widthM: 1.1,
    heightM: 1.7,
    wattW: 400,
    gapM: 0.02,
  });
  const [panelSpecMode, setPanelSpecMode] = useState<"auto" | "manual">("auto");
  const [panelChoiceId, setPanelChoiceId] = useState<string>(PANEL_OPTIONS[0]?.id ?? "custom");
  const [panelBrandRec, setPanelBrandRec] = useState<
    | {
        selectedId: string;
        brand: string;
        model: string;
        sourceUrl: string;
        why: string[];
        caveats: string[];
        source: {
          kind: "gemini" | "fallback";
          usedModel: string | null;
          fallbackReason: string | null;
          attemptedModels: string[];
        };
      }
    | null
  >(null);
  const [panelBrandBusy, setPanelBrandBusy] = useState(false);
  const [panelBrandError, setPanelBrandError] = useState<string | null>(null);
  const lastPanelAutoKeyRef = useRef<string | null>(null);
  const [panelAutoReadyKey, setPanelAutoReadyKey] = useState<string | null>(null);
  const [panelBrandReqSeq, setPanelBrandReqSeq] = useState(0);
  const panelBrandAbortRef = useRef<AbortController | null>(null);
  const lastPanelBrandAutoAddrKeyRef = useRef<string | null>(null);
  const panelBrandCtxRef = useRef<{
    closed: boolean;
    vertices: Point[];
    mPerPx: number | null;
    orientationDeg: number;
    panelSpec: PanelSpec;
    panelSpecMode: "auto" | "manual";
    panelChoiceId: string;
    roofAreaM2: number | null;
    lat: number | null;
    lng: number | null;
  }>({
    closed: false,
    vertices: [],
    mPerPx: null,
    orientationDeg: 0,
    panelSpec,
    panelSpecMode: "auto",
    panelChoiceId: "custom",
    roofAreaM2: null,
    lat: null,
    lng: null,
  });
  const [orientationDeg, setOrientationDeg] = useState<number>(0);
  const [roofAxisHintDeg, setRoofAxisHintDeg] = useState<number | null>(null);
  const [tiltDeg, setTiltDeg] = useState<number>(20);
  const [azimuthDeg, setAzimuthDeg] = useState<number>(180);
  const [lossesPct, setLossesPct] = useState<number>(14);

  const [vertices, setVertices] = useState<Point[]>([]);
  const [closed, setClosed] = useState<boolean>(false);
  const [panelsPacked, setPanelsPacked] = useState<PlacedPanel[]>([]);
  const [panelCountOverride, setPanelCountOverride] = useState<number | null>(null);

  const panels = useMemo(() => {
    if (panelCountOverride === null) return panelsPacked;
    const max = panelsPacked.length;
    const n = Math.max(0, Math.min(max, Math.floor(panelCountOverride)));
    return panelsPacked.slice(0, n);
  }, [panelCountOverride, panelsPacked]);

  const [autoOutlineBusy, setAutoOutlineBusy] = useState(false);
  const [autoOutlineError, setAutoOutlineError] = useState<string | null>(null);
  const [autoOutlineHint, setAutoOutlineHint] = useState<string | null>(null);
  const [candidatePolygons, setCandidatePolygons] = useState<
    Array<{ id: string; polygon: Point[]; score?: number }> | null
  >(null);

  const segmentAbortRef = useRef<AbortController | null>(null);
  const lastAutoSegmentKeyRef = useRef<string | null>(null);

  const [estimate, setEstimate] = useState<Estimate>({
    annualKwh: 0,
    monthlyKwh: Array.from({ length: 12 }, () => 0),
    annualCo2Kg: 0,
    source: "fallback",
  });

  const panelCountAuto = panelsPacked.length;
  const panelCount = panels.length;
  const dcKw = useMemo(
    () => (panelCount * panelSpec.wattW) / 1000,
    [panelCount, panelSpec.wattW],
  );

  const setManualPanelCount = useCallback(
    (raw: number) => {
      if (!Number.isFinite(raw)) return;
      const max = Math.max(0, panelCountAuto);
      const n = Math.max(0, Math.min(max, Math.round(raw)));
      if (n >= max) setPanelCountOverride(null);
      else setPanelCountOverride(n);
    },
    [panelCountAuto],
  );

  const manualPanelCount = panelCountOverride === null ? panelCountAuto : panelCountOverride;

  useEffect(() => {
    if (panelCountOverride === null) return;
    const max = Math.max(0, panelCountAuto);
    const n = Math.max(0, Math.min(max, Math.floor(panelCountOverride)));
    if (n >= max) setPanelCountOverride(null);
    else if (n !== panelCountOverride) setPanelCountOverride(n);
  }, [panelCountAuto, panelCountOverride]);

  const panelChoiceLabel = useMemo(() => {
    if (panelChoiceId === "custom") return "Custom"
    return PANEL_OPTIONS.find((c) => c.id === panelChoiceId)?.label ?? "Standard"
  }, [panelChoiceId]);

  const roofAreaM2 = useMemo(() => {
    if (!closed || vertices.length < 3 || !mPerPx) return null;
    return polygonAreaPx2(vertices) * mPerPx * mPerPx;
  }, [closed, mPerPx, vertices]);

  const historySnapshot = useMemo<HistorySnapshot | null>(() => {
    if (mapInput.kind !== "address") return null;
    if (lat === null || lng === null) return null;
    if (!closed || vertices.length < 3 || panelCount <= 0) return null;

    const address = mapInput.address?.trim() ? mapInput.address.trim() : null;
    const nextZoom = Number.isFinite(zoom) ? Math.round(zoom) : 19;
    const snapMPerPx = mPerPx ?? null;

    return {
      mode: "address",
      address,
      lat,
      lng,
      zoom: nextZoom,
      mPerPx: snapMPerPx,
      siteSpec: {
        tiltDeg,
        azimuthDeg,
        lossesPct,
      },
      panelSpec: {
        widthM: panelSpec.widthM,
        heightM: panelSpec.heightM,
        wattW: panelSpec.wattW,
        gapM: panelSpec.gapM,
      },
      layoutSummary: {
        orientationDeg,
        panelCount,
        dcKw,
      },
      geometry: {
        vertices: vertices.map((p) => ({ x: p.x, y: p.y })),
        closed,
        mPerPx: snapMPerPx,
        zoom: nextZoom,
      },
      estimate:
        estimate.annualKwh > 0 && estimate.monthlyKwh.length === 12
          ? {
              annualKwh: estimate.annualKwh,
              monthlyKwh: estimate.monthlyKwh,
              annualCo2Kg: estimate.annualCo2Kg,
              assumptions: estimate.assumptions,
            }
          : null,
    };
  }, [
    azimuthDeg,
    closed,
    dcKw,
    estimate.annualCo2Kg,
    estimate.annualKwh,
    estimate.assumptions,
    estimate.monthlyKwh,
    lat,
    lng,
    lossesPct,
    mPerPx,
    mapInput.address,
    mapInput.kind,
    orientationDeg,
    panelCount,
    panelSpec.gapM,
    panelSpec.heightM,
    panelSpec.wattW,
    panelSpec.widthM,
    tiltDeg,
    vertices,
    zoom,
  ]);

  const historySummary = useMemo<HistorySummary | null>(() => {
    if (!historySnapshot) return null;
    return historySummaryFromSnapshot(historySnapshot);
  }, [historySnapshot]);

  useEffect(() => {
    if (!panelsMounted || !opened) return;
    if (!historySnapshot || !historySummary) return;

    const signature = historySaveSignature(historySnapshot, historySummary);
    if (lastHistorySigRef.current === signature) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        await saveHistory({ snapshot: historySnapshot, summary: historySummary });
        if (cancelled) return;
        lastHistorySigRef.current = signature;
      } catch {
        // history is optional; avoid interrupting main experience
      }
    }, 1800);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [historySnapshot, historySummary, opened, panelsMounted]);

  const loadHistorySnapshot = useCallback((snapshot: HistorySnapshot) => {
    if (snapshot.mode !== "address") return;

    reverseGeocodeAbortRef.current?.abort();
    segmentAbortRef.current?.abort();
    lastAutoSegmentKeyRef.current = null;

    const nextZoom = Number.isFinite(snapshot.zoom) ? Math.round(snapshot.zoom) : 19;
    const nextMPerPx = snapshot.mPerPx ?? snapshot.geometry.mPerPx ?? null;

    setMapInput({
      kind: "address",
      address: snapshot.address ?? "",
      lat: snapshot.lat,
      lng: snapshot.lng,
      zoom: nextZoom,
      mPerPx: nextMPerPx,
    });
    setLat(snapshot.lat);
    setLng(snapshot.lng);
    setZoom(nextZoom);

    setTiltDeg(snapshot.siteSpec.tiltDeg);
    setAzimuthDeg(snapshot.siteSpec.azimuthDeg);
    setLossesPct(snapshot.siteSpec.lossesPct);
    setPanelSpec({
      widthM: snapshot.panelSpec.widthM,
      heightM: snapshot.panelSpec.heightM,
      wattW: snapshot.panelSpec.wattW,
      gapM: snapshot.panelSpec.gapM,
    });
    setPanelSpecMode("manual");
    setPanelChoiceId("custom");
    setOrientationDeg(snapshot.layoutSummary.orientationDeg);

    setVertices(snapshot.geometry.vertices.map((p) => ({ x: p.x, y: p.y })));
    setClosed(snapshot.geometry.closed);

    if (snapshot.estimate && snapshot.estimate.monthlyKwh.length === 12) {
      setEstimate({
        annualKwh: snapshot.estimate.annualKwh,
        monthlyKwh: snapshot.estimate.monthlyKwh,
        annualCo2Kg: snapshot.estimate.annualCo2Kg,
        source: "server",
        assumptions: snapshot.estimate.assumptions,
      });
    }

    setCandidatePolygons(null);
    setAutoOutlineBusy(false);
    setAutoOutlineError(null);
    setAutoOutlineHint("Loaded from history.");

    setSettingsOpen(false);
    setShowShare(false);
    setHistoryOpen(false);
    setActionNotice("Loaded history snapshot.");
    setMobilePane("setup");

    setPanelsMounted(true);
    setEntered(true);
    setPhase("app");

    const summary = historySummaryFromSnapshot(snapshot);
    lastHistorySigRef.current = historySaveSignature(snapshot, summary);
  }, []);

  const panelBrandAddrKey = useMemo(() => {
    if (mapInput.kind !== "address") return null;
    if (mapInput.lat === null || mapInput.lng === null) return null;
    return `${mapInput.lat.toFixed(5)}:${mapInput.lng.toFixed(5)}`;
  }, [mapInput.kind, mapInput.lat, mapInput.lng]);

  // Keep a stable snapshot for the Gemini effect so it only runs when explicitly triggered.
  panelBrandCtxRef.current = {
    closed,
    vertices,
    mPerPx,
    orientationDeg,
    panelSpec,
    panelSpecMode,
    panelChoiceId,
    roofAreaM2,
    lat,
    lng,
  };

  // Auto-run panel recommendation once per address (after roof is traced).
  useEffect(() => {
    if (!panelsMounted) return;
    if (!panelBrandAddrKey) return;
    if (!closed || vertices.length < 3 || !mPerPx || !roofAreaM2) return;

    if (lastPanelBrandAutoAddrKeyRef.current === panelBrandAddrKey) return;
    lastPanelBrandAutoAddrKeyRef.current = panelBrandAddrKey;

    setPanelBrandRec(null);
    setPanelBrandError(null);
    setPanelBrandReqSeq((s) => s + 1);
  }, [closed, mPerPx, panelBrandAddrKey, panelsMounted, roofAreaM2, vertices.length]);

  useEffect(() => {
    if (!panelsMounted) return;
    if (panelSpecMode !== "auto") return;
    if (!closed || vertices.length < 3 || !mPerPx) return;

     const axisDeg = roofAxisHintDeg ?? polygonDominantEdgeAxisDeg(vertices);

    const key = `roof:${Math.round((roofAreaM2 ?? 0) * 10) / 10}:${vertices.length}:${Math.round(mPerPx * 1e6)}`;
    if (lastPanelAutoKeyRef.current === key) return;
    lastPanelAutoKeyRef.current = key;

    let best = { id: PANEL_OPTIONS[0]?.id ?? "custom", spec: PANEL_OPTIONS[0]?.spec ?? panelSpec, orient: 0, dc: -Infinity };
    for (const c of PANEL_OPTIONS) {
      const orient = bestRoofAlignedPackingOrientationDeg({ polygon: vertices, mPerPx, panelSpec: c.spec, axisDeg });
      const count = packPanelsDeterministic({
        usablePolygon: vertices,
        mPerPx,
        panel: { widthM: c.spec.widthM, heightM: c.spec.heightM, gapM: c.spec.gapM },
        orientationDeg: orient,
      }).length;
      const dc = (count * c.spec.wattW) / 1000;
      if (dc > best.dc + 1e-6) {
        best = { id: c.id, spec: c.spec, orient, dc };
      }
    }

    setPanelChoiceId(best.id);
    setPanelSpec(best.spec);
    setOrientationDeg(best.orient);
    setPanelAutoReadyKey(key);
    setPanelBrandRec(null);
    setPanelBrandError(null);
  }, [
    closed,
    mPerPx,
    panelSpec,
    panelSpecMode,
    panelsMounted,
    roofAreaM2,
    vertices,
    roofAxisHintDeg,
  ]);

  useEffect(() => {
    if (panelSpecMode === "auto") return;
    lastPanelAutoKeyRef.current = null;
    setPanelAutoReadyKey(null);
  }, [panelSpecMode]);

  useEffect(() => {
    if (!panelsMounted) return;
    if (panelBrandReqSeq === 0) return;

    const ctx = panelBrandCtxRef.current;
    if (!ctx.closed || ctx.vertices.length < 3 || !ctx.mPerPx || !ctx.roofAreaM2) {
      setPanelBrandError("Trace and calibrate a roof area first.");
      return;
    }
    if (ctx.lat === null || ctx.lng === null) {
      setPanelBrandError("Set an address first.");
      return;
    }

    const vertices = ctx.vertices;
    const mPerPx = ctx.mPerPx;
    const panelSpec = ctx.panelSpec;
    const panelSpecMode = ctx.panelSpecMode;
    const panelChoiceId = ctx.panelChoiceId;
    const roofAreaM2 = ctx.roofAreaM2;
    const lat = ctx.lat;
    const lng = ctx.lng;

    panelBrandAbortRef.current?.abort();
    const ac = new AbortController();
    panelBrandAbortRef.current = ac;

    setPanelBrandBusy(true);
    setPanelBrandError(null);

    const axisDeg = polygonDominantEdgeAxisDeg(vertices);

    const fits: Array<{
      id: string;
      label: string;
      brand: string;
      model: string;
      sourceUrl?: string;
      spec: { widthM: number; heightM: number; wattW: number; gapM: number };
      fit: { panelCount: number; dcKw: number; orientationDeg: number };
    }> = PANEL_OPTIONS.map((o) => {
      const orient = bestRoofAlignedPackingOrientationDeg({ polygon: vertices, mPerPx, panelSpec: o.spec, axisDeg });
      const count = packPanelsDeterministic({
        usablePolygon: vertices,
        mPerPx,
        panel: { widthM: o.spec.widthM, heightM: o.spec.heightM, gapM: o.spec.gapM },
        orientationDeg: orient,
      }).length;
      const dc = (count * o.spec.wattW) / 1000;
      return {
        id: o.id,
        label: o.label,
        brand: o.brand,
        model: o.model,
        sourceUrl: o.sourceUrl,
        spec: { widthM: o.spec.widthM, heightM: o.spec.heightM, wattW: o.spec.wattW, gapM: o.spec.gapM },
        fit: { panelCount: count, dcKw: dc, orientationDeg: orient },
      };
    });

    if (panelSpecMode === "manual") {
      const orient = bestRoofAlignedPackingOrientationDeg({ polygon: vertices, mPerPx, panelSpec, axisDeg });
      const count = packPanelsDeterministic({
        usablePolygon: vertices,
        mPerPx,
        panel: { widthM: panelSpec.widthM, heightM: panelSpec.heightM, gapM: panelSpec.gapM },
        orientationDeg: orient,
      }).length;
      const dc = (count * panelSpec.wattW) / 1000;
      fits.unshift({
        id: "custom",
        label: "Custom size",
        brand: "(custom)",
        model: "User-defined",
        sourceUrl: undefined,
        spec: {
          widthM: panelSpec.widthM,
          heightM: panelSpec.heightM,
          wattW: panelSpec.wattW,
          gapM: panelSpec.gapM,
        },
        fit: { panelCount: count, dcKw: dc, orientationDeg: orient },
      });
    }

    (async () => {
      try {
        let geminiKey = "";
        try {
          geminiKey = String(window.localStorage.getItem("sunnyview-gemini-api-key-v1") ?? "").trim();
        } catch {
          geminiKey = "";
        }

        const headers: Record<string, string> = { "content-type": "application/json" };
        if (geminiKey) headers["x-gemini-api-key"] = geminiKey;

        const res = await fetch(apiUrl("/api/panel-recommend"), {
          method: "POST",
          headers,
          signal: ac.signal,
          body: JSON.stringify({
            lat,
            lng,
            roofAreaM2,
            options: fits,
            currentId: panelChoiceId,
            notes:
              "Pick the best option for this roof based on energy yield per area, reliability, and the computed fit counts.",
          }),
        });
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const message =
            typeof data?.error === "string" ? data.error : `Panel recommendation failed (${res.status})`;
          const normalized =
            message.includes("Missing GEMINI_API_KEY") || message.includes("Missing Gemini API key")
              ? "Missing Gemini API key. Add it on the landing page."
              : message;
          const attempted = Array.isArray(data?.attemptedModels)
            ? data.attemptedModels.map((v: any) => String(v)).filter(Boolean)
            : [];
          const withAttempted = attempted.length
            ? `${normalized} (models tried: ${attempted.join(", ")})`
            : normalized;
          throw new Error(withAttempted);
        }

        const selectedId = typeof data?.selectedId === "string" ? data.selectedId : null;
        const brand = typeof data?.brand === "string" ? data.brand : null;
        const model = typeof data?.model === "string" ? data.model : null;
        const sourceUrl = typeof data?.sourceUrl === "string" ? data.sourceUrl : null;
        const why = Array.isArray(data?.why) ? data.why.map((v: any) => String(v)) : [];
        const caveats = Array.isArray(data?.caveats) ? data.caveats.map((v: any) => String(v)) : [];
        if (!selectedId || !brand || !model || !sourceUrl) throw new Error("Invalid Gemini response");

        const usedModel = typeof data?.usedModel === "string" ? String(data.usedModel) : null;
        const attemptedModels = Array.isArray(data?.attemptedModels)
          ? data.attemptedModels.map((v: any) => String(v)).filter(Boolean)
          : [];
        const fallbackReason = typeof data?.fallbackReason === "string" ? String(data.fallbackReason) : null;
        const kind: "gemini" | "fallback" = "gemini";

        setPanelBrandRec({
          selectedId,
          brand,
          model,
          sourceUrl,
          why: why.slice(0, 4),
          caveats: caveats.slice(0, 3),
          source: {
            kind,
            usedModel,
            fallbackReason,
            attemptedModels,
          },
        });

        if (panelSpecMode === "auto") {
          const picked = fits.find((f) => f.id === selectedId);
          if (picked) {
            setPanelChoiceId(picked.id);
            setPanelSpec({
              widthM: picked.spec.widthM,
              heightM: picked.spec.heightM,
              wattW: picked.spec.wattW,
              gapM: picked.spec.gapM,
            });
            if (typeof picked.fit?.orientationDeg === "number") {
              setOrientationDeg(clampAngle90(picked.fit.orientationDeg));
            }
          }
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Panel recommendation failed.";
        setPanelBrandError(msg);
      } finally {
        if (!ac.signal.aborted) setPanelBrandBusy(false);
      }
    })();

    return () => ac.abort();
  }, [panelBrandReqSeq, panelsMounted]);

  const fallbackEstimate = useMemo((): Estimate => {
    const annualKwh = Math.max(0, dcKw) * 1400;
    const monthly = Array.from({ length: 12 }, () => annualKwh / 12);
    const annualCo2Kg = annualKwh * 0.4;
    return { annualKwh, monthlyKwh: monthly, annualCo2Kg, source: "fallback" };
  }, [dcKw]);

  useEffect(() => {
    if (!panelsMounted) return;
    setEstimate((prev) => (prev.source === "server" ? prev : fallbackEstimate));
  }, [fallbackEstimate, panelsMounted]);

  useEffect(() => {
    if (!panelsMounted) return;
    const t = window.setTimeout(() => {
      if (!closed || vertices.length < 3 || !mPerPx) {
        setPanelsPacked([]);
        return;
      }

      const key = `roof:${Math.round((roofAreaM2 ?? 0) * 10) / 10}:${vertices.length}:${Math.round(mPerPx * 1e6)}`;
      if (panelSpecMode === "auto" && panelAutoReadyKey !== key) {
        // Wait until auto panel sizing/pick runs for this roof.
        setPanelsPacked([]);
        return;
      }

      setPanelsPacked(
        packPanelsDeterministic({
          usablePolygon: vertices,
          mPerPx,
          panel: {
            widthM: panelSpec.widthM,
            heightM: panelSpec.heightM,
            gapM: panelSpec.gapM,
          },
          orientationDeg,
        }),
      );
    }, 80);
    return () => window.clearTimeout(t);
  }, [
    panelsMounted,
    closed,
    vertices,
    mPerPx,
    panelAutoReadyKey,
    panelSpec.widthM,
    panelSpec.heightM,
    panelSpec.gapM,
    panelSpecMode,
    roofAreaM2,
    orientationDeg,
  ]);

  const estimateAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!panelsMounted) return;
    const hasSite = Number.isFinite(lat ?? NaN) && Number.isFinite(lng ?? NaN);
    if (!hasSite || dcKw <= 0) return;
    let localAbort: AbortController | null = null;
    const t = window.setTimeout(async () => {
      estimateAbortRef.current?.abort();
      const ac = new AbortController();
      localAbort = ac;
      estimateAbortRef.current = ac;
      try {
        const res = await fetch(apiUrl("/api/estimate"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({
            siteSpec: { lat, lng, tiltDeg, azimuthDeg, lossesPct },
            layoutSummary: { dcKw, panelCount, orientationDeg },
            panelSpec,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as any;
        const annualKwh =
          coerceNumber(data?.annualKwh) ??
          coerceNumber(data?.estimate?.annualKwh);
        const annualCo2Kg =
          coerceNumber(data?.annualCo2Kg) ??
          coerceNumber(data?.estimate?.annualCo2Kg);
        const monthlyKwh = Array.isArray(data?.monthlyKwh)
          ? data.monthlyKwh.map((v: any) => Number(v) || 0)
          : null;
        if (annualKwh === null || annualCo2Kg === null) return;
        setEstimate({
          annualKwh,
          annualCo2Kg,
          monthlyKwh:
            monthlyKwh && monthlyKwh.length === 12
              ? monthlyKwh
              : Array.from({ length: 12 }, () => annualKwh / 12),
          source: "server",
          assumptions: data?.assumptions ?? data?.estimate?.assumptions,
        });
      } catch {
        // keep fallback
      }
    }, 320);
    return () => {
      window.clearTimeout(t);
      localAbort?.abort();
    };
  }, [
    panelsMounted,
    lat,
    lng,
    tiltDeg,
    azimuthDeg,
    lossesPct,
    dcKw,
    panelCount,
    orientationDeg,
    panelSpec,
  ]);

  const background = useMemo(() => {
    if (mapInput.kind === "image" && mapInput.image) {
      return {
        kind: "image" as const,
        src: mapInput.image.dataUrl,
        widthPx: mapInput.image.widthPx,
        heightPx: mapInput.image.heightPx,
      };
    }
    if (addressStatic) {
      return {
        kind: "image" as const,
        src: addressStatic.src,
        widthPx: addressStatic.widthPx,
        heightPx: addressStatic.heightPx,
      };
    }
    return { kind: "none" as const };
  }, [addressStatic, mapInput.kind, mapInput.image]);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const creatingProjectRef = useRef(false);
  const projectCreateFailedRef = useRef(false);

  useEffect(() => {
    if (mapInput.kind === "image") return;
    setCandidatePolygons(null);
    setAutoOutlineBusy(false);
    setAutoOutlineError(null);
    setAutoOutlineHint(null);
  }, [mapInput.kind]);

  function returnToLanding() {
    setShowShare(false);
    setSettingsOpen(false);
    setActionNotice(null);
    setPhase("landing");
  }

  function clearSite() {
    reverseGeocodeAbortRef.current?.abort();
    segmentAbortRef.current?.abort();

    lastAutoSegmentKeyRef.current = null;
    lastHistorySigRef.current = null;

    setMapInput({
      kind: "address",
      address: "",
      lat: null,
      lng: null,
      zoom: 19,
      mPerPx: null,
    });
    setLat(null);
    setLng(null);
    setZoom(19);

    setVertices([]);
    setClosed(false);
    setPanelsPacked([]);
    setPanelCountOverride(null);
    setCandidatePolygons(null);
    setAutoOutlineBusy(false);
    setAutoOutlineError(null);
    setAutoOutlineHint(null);

    setMobilePane("setup");
  }

  useEffect(() => {
    if (!panelsMounted) return;
    if (!hasBackend) return;
    if (projectCreateFailedRef.current) return;
    const hasSeed =
      (mapInput.kind === "address" &&
        Number.isFinite(lat ?? NaN) &&
        Number.isFinite(lng ?? NaN)) ||
      (mapInput.kind === "image" && !!mapInput.image?.dataUrl);
    if (!hasSeed) return;
    if (projectId) return;
    if (creatingProjectRef.current) return;

    let cancelled = false;
    (async () => {
      creatingProjectRef.current = true;
      try {
        const res = await fetch(apiUrl("/api/projects"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Untitled",
            siteSpec:
              lat !== null && lng !== null
                ? { lat, lng, tiltDeg, azimuthDeg, lossesPct }
                : undefined,
            panelSpec,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json().catch(() => null)) as any;
        if (cancelled) return;
        const id = String(
          data?.projectId ?? data?.id ?? data?.project?.id ?? "",
        );
        const slug = String(data?.shareSlug ?? data?.project?.shareSlug ?? "");
        if (id) setProjectId(id);
        if (slug) setShareSlug(slug);
      } catch {
        projectCreateFailedRef.current = true;
        setActionNotice(
          "Could not connect to project backend. Sharing is currently unavailable.",
        );
        // ignore
      } finally {
        creatingProjectRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    panelsMounted,
    hasBackend,
    azimuthDeg,
    lat,
    lng,
    lossesPct,
    mapInput,
    panelSpec,
    projectId,
    tiltDeg,
  ]);

  useEffect(() => {
    if (!panelsMounted) return;
    if (!projectId) return;
    const t = window.setTimeout(async () => {
      try {
        await fetch(apiUrl(`/api/projects/${encodeURIComponent(projectId)}`), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteSpec:
              lat !== null && lng !== null
                ? { lat, lng, tiltDeg, azimuthDeg, lossesPct }
                : undefined,
            panelSpec,
            layoutSummary: { dcKw, panelCount, orientationDeg },
            geometry: {
              vertices,
              closed,
              mPerPx,
              background: mapInput.kind,
              zoom,
            },
            estimate,
          }),
        });
      } catch {
        // ignore
      }
    }, 900);
    return () => window.clearTimeout(t);
  }, [
    panelsMounted,
    azimuthDeg,
    closed,
    dcKw,
    estimate,
    lat,
    lng,
    lossesPct,
    mPerPx,
    mapInput.kind,
    orientationDeg,
    panelCount,
    panelSpec,
    projectId,
    tiltDeg,
    vertices,
    zoom,
  ]);

  const [explainLoading, setExplainLoading] = useState(false);
  const [explainText, setExplainText] = useState<{
    bullets: string[];
    caveat: string;
  } | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [hasLocalElevenLabsKey, setHasLocalElevenLabsKey] = useState<boolean | null>(null);

  useEffect(() => {
    if (!opened) {
      setHasLocalElevenLabsKey(null);
      return;
    }

    const read = () => {
      try {
        const k = String(
          window.localStorage.getItem("sunnyview-elevenlabs-api-key-v1") ?? "",
        ).trim();
        setHasLocalElevenLabsKey(k.length > 0);
      } catch {
        setHasLocalElevenLabsKey(false);
      }
    };

    read();
    const t = window.setTimeout(read, 260);
    return () => window.clearTimeout(t);
  }, [opened]);

  const sceneMode = opened ? "grid" : "fusion";

  async function runExplain() {
    setExplainLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch(apiUrl("/api/explain"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          estimate,
          assumptions: {
            siteSpec: { lat, lng, tiltDeg, azimuthDeg, lossesPct },
            panelSpec,
            orientationDeg,
            panelCount,
            dcKw,
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Explain failed (${res.status})`,
        );
      }
      const bullets = Array.isArray(data?.bullets)
        ? data.bullets.map((b: any) => String(b))
        : null;
      const caveat = data?.caveat
        ? String(data.caveat)
        : Array.isArray(data?.caveats) && data.caveats.length
          ? String(data.caveats[0])
        : "Solar output is an estimate; shading, tilt, and local conditions can change results.";
      if (bullets && bullets.length) {
        setExplainText({ bullets: bullets.slice(0, 3), caveat });
      } else {
        setExplainText({
          bullets: [
            `This layout fits ${panelCount} panels (${dcKw.toFixed(1)} kW DC).`,
            `Estimated annual energy: ${Math.round(estimate.annualKwh).toLocaleString()} kWh.`,
            `Estimated annual CO₂ avoided: ${Math.round(estimate.annualCo2Kg).toLocaleString()} kg.`,
          ],
          caveat,
        });
      }
    } catch {
      setExplainText({
        bullets: [
          `This layout fits ${panelCount} panels (${dcKw.toFixed(1)} kW DC).`,
          `Estimated annual energy: ${Math.round(estimate.annualKwh).toLocaleString()} kWh.`,
          `Estimated annual CO₂ avoided: ${Math.round(estimate.annualCo2Kg).toLocaleString()} kg.`,
        ],
        caveat:
          "Solar output is an estimate; shading, tilt, and local conditions can change results.",
      });
    } finally {
      setExplainLoading(false);
    }
  }

  async function runTalk() {
    const text =
      explainText?.bullets?.join(" ") ??
      `This layout fits ${panelCount} panels (${dcKw.toFixed(1)} kilowatts DC) and produces about ${Math.round(estimate.annualKwh).toLocaleString()} kilowatt-hours per year.`;
    setTtsLoading(true);
    setActionNotice(null);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };

      let key = "";
      try {
        key = String(
          window.localStorage.getItem("sunnyview-elevenlabs-api-key-v1") ?? "",
        ).trim();
      } catch {
        key = "";
      }
      setHasLocalElevenLabsKey(key.length > 0);

      const origin = (() => {
        try {
          return window.location.origin;
        } catch {
          return "";
        }
      })();
      const backendOrigin = apiOrigin();
      const sameOrigin = backendOrigin.length === 0 || backendOrigin === origin;

      if (key && sameOrigin) {
        headers["x-elevenlabs-api-key"] = key;
      } else if (key && !sameOrigin) {
        setActionNotice(
          "ElevenLabs key is stored locally, but this app is configured to use an external backend (NEXT_PUBLIC_API_ORIGIN). For safety, the key is not sent. Set ELEVENLABS_API_KEY on the backend instead."
        );
      }

      let voiceId = "";
      try {
        voiceId = String(
          window.localStorage.getItem("sunnyview-elevenlabs-voice-id-v1") ?? "",
        ).trim();
      } catch {
        voiceId = "";
      }

      const res = await fetch(apiUrl("/api/tts"), {
        method: "POST",
        headers,
        body: JSON.stringify({ text, voiceId: voiceId || undefined }),
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Text-to-speech failed (${res.status})`,
        );
      }
      const audioUrl =
        typeof data?.audioUrl === "string" ? data.audioUrl : null;
      if (!audioUrl) {
        const note =
          typeof data?.note === "string"
            ? data.note
            : "Text-to-speech is not available right now.";
        setActionNotice(note);
        return;
      }
      const audio = new Audio(audioUrl);
      await audio.play();
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Text-to-speech is not available right now.";
      setActionNotice(message);
    } finally {
      setTtsLoading(false);
    }
  }

  const runAutoOutline = useCallback(
    async (opts?: {
      reason?: "auto" | "manual";
      roi?: { x: number; y: number; w: number; h: number } | null;
      metaOverride?: Record<string, unknown> | null;
    }) => {
      const reason = opts?.reason ?? "manual";
      const roi = opts?.roi ?? null;
      const metaOverride = opts?.metaOverride ?? null;

      const request = (() => {
        if (mapInput.kind === "image" && mapInput.image?.dataUrl) {
          const w = mapInput.image.widthPx;
          const h = mapInput.image.heightPx;
          const click = roi
            ? { x: roi.x + roi.w / 2, y: roi.y + roi.h / 2, type: "pos" as const }
            : { x: w / 2, y: h / 2, type: "pos" as const };
          return {
            w,
            h,
            body: {
              imageDataUrl: mapInput.image.dataUrl,
              mode: "roof",
              clicks: [click],
              ...(roi ? { roi } : {}),
              meta: {
                lat: mapInput.lat,
                lng: mapInput.lng,
                zoom: mapInput.zoom,
                widthPx: w,
                heightPx: h,
                address: mapInput.address ?? null,
                ...(metaOverride ?? {}),
              },
            },
          };
        }

        if (mapInput.kind === "address" && addressStatic) {
          const w = addressStatic.widthPx;
          const h = addressStatic.heightPx;
          const clicks = roi
            ? ([{ x: roi.x + roi.w / 2, y: roi.y + roi.h / 2, type: "pos" as const }] as const)
            : null;
          return {
            w,
            h,
            body: {
              imageUrl: addressStatic.src,
              mode: "roof",
              ...(clicks ? { clicks: clicks as any } : {}),
              ...(roi ? { roi } : {}),
              meta: {
                ...addressStatic.meta,
                address: addressStatic.address,
                ...(metaOverride ?? {}),
              },
            },
          };
        }

        return null;
      })();

      if (!request) return;

      segmentAbortRef.current?.abort();
      const ac = new AbortController();
      segmentAbortRef.current = ac;

      setAutoOutlineBusy(true);
      setAutoOutlineError(null);
      setAutoOutlineHint(null);
      setCandidatePolygons(null);

      try {
        const res = await fetch(apiUrl("/api/segment"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify(request.body),
        });
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          const msg =
            typeof data?.error === "string"
              ? data.error
              : `Segmentation failed (HTTP ${res.status})`;
          throw new Error(msg);
        }

        const note = typeof data?.note === "string" ? String(data.note) : null;

        const candidatesRaw = Array.isArray(data?.candidates) ? (data.candidates as any[]) : [];
        const candidates = candidatesRaw
          .map((c, idx) => {
            const id = typeof c?.id === "string" ? c.id : String(idx);
            const score = Number(c?.score);
            const poly = normalizePolygon(c?.polygon ?? c?.roofPolygon ?? c, request.w, request.h);
            if (!poly) return null;
            return {
              id,
              polygon: poly,
              score: Number.isFinite(score) ? score : undefined,
            };
          })
          .filter(Boolean) as Array<{ id: string; polygon: Point[]; score?: number }>;

        if (candidates.length) setCandidatePolygons(candidates);

        const polyRaw =
          data?.roofPolygon ??
          data?.polygon ??
          data?.usablePolygon ??
          data?.result?.roofPolygon ??
          data?.result?.polygon;

        const primary =
          normalizePolygon(polyRaw, request.w, request.h) ??
          (candidates.length ? candidates[0].polygon : null);

        if (!primary) {
          throw new Error("No roof polygon returned");
        }

        const source =
          typeof data?.source === "string"
            ? String(data.source)
            : typeof data?.result?.source === "string"
              ? String(data.result.source)
              : null;
        const confidence =
          coerceNumber(data?.confidence) ??
          coerceNumber(data?.result?.confidence);
        const looksLikeFootprint =
          typeof source === "string" &&
          (source === "osm_building" ||
            source === "osm_candidates" ||
            source.startsWith("osm_") ||
            source.includes("footprint"));

        let selected = primary;
        let hint: string | null = null;

        // Keep the full roof outline as returned. (Single-plane selection is optional and should not replace the roof mask.)

        // Auto-orient panels from CV (preferred) or polygon geometry.
        const suggestedOrient =
          coerceNumber(data?.suggestedOrientationDeg) ??
          coerceNumber(data?.result?.suggestedOrientationDeg);
        const suggestedAz =
          coerceNumber(data?.suggestedAzimuthDeg) ??
          coerceNumber(data?.result?.suggestedAzimuthDeg);

        const axisHint = suggestedOrient !== null ? normAxis90(suggestedOrient) : null;
        setRoofAxisHintDeg(axisHint);

        const axisDeg = axisHint ?? polygonDominantEdgeAxisDeg(selected);
        if (mPerPx) {
          setOrientationDeg(
            bestRoofAlignedPackingOrientationDeg({
              polygon: selected,
              mPerPx,
              panelSpec,
              axisDeg,
            })
          );
        } else {
          setOrientationDeg(clampAngle90(axisDeg));
        }
        if (suggestedAz !== null) {
          const az = ((suggestedAz % 360) + 360) % 360;
          setAzimuthDeg(az);
        }

        setPanelsPacked([]);
        setPanelCountOverride(null);
        setVertices(selected);
        setClosed(true);

        if (!hint && reason === "auto" && candidates.length > 1) {
          hint = "Multiple roofs nearby. Click Edit to pick.";
        }
        const safeNote = note && note.length <= 52 ? note : null;
        if (!hint && safeNote) hint = safeNote;

        const fallbackish =
          typeof source === "string" &&
          (source === "fallback_rect" || source.includes("fallback_rect") || source.includes("segmenter_error"));
        const lowConfidence = confidence !== null && confidence < 0.32;
        if ((fallbackish || lowConfidence) && !hint) {
          hint = "Edit -> Auto-outline.";
        } else if (!hint && looksLikeFootprint) {
          hint = "OSM outline. Edit -> Auto-outline.";
        }
        if (hint) setAutoOutlineHint(hint);
      } catch (e) {
        if (ac.signal.aborted) return;
        setAutoOutlineError(e instanceof Error ? e.message : "Auto-outline failed.");
      } finally {
        if (!ac.signal.aborted) setAutoOutlineBusy(false);
      }
    },
    [addressStatic, mPerPx, mapInput, panelSpec]
  );

  // Address flow: after a successful search, fetch one static satellite image and
  // auto-detect the roof immediately (no extra "Auto-outline" click needed).
  useEffect(() => {
    if (!panelsMounted) return;
    if (mapInput.kind !== "address") return;
    if (!addressStatic) return;

    const key = `addr:${addressStatic.meta.lat.toFixed(6)}:${addressStatic.meta.lng.toFixed(6)}:${addressStatic.meta.zoom}`;
    if (lastAutoSegmentKeyRef.current === key) return;
    lastAutoSegmentKeyRef.current = key;

    setVertices([]);
    setClosed(false);
    setPanelsPacked([]);
    setPanelCountOverride(null);
    setCandidatePolygons(null);
    setAutoOutlineError(null);
    setAutoOutlineHint(null);
    setRoofAxisHintDeg(null);
    setPanelAutoReadyKey(null);
    lastPanelAutoKeyRef.current = null;

    void runAutoOutline({ reason: "auto" });
  }, [addressStatic, mapInput.kind, panelsMounted, runAutoOutline]);

  const pickCandidate = useCallback(
    (id: string) => {
      const c = candidatePolygons?.find((p) => p.id === id);
      if (!c) return;
      setVertices(c.polygon);
      setClosed(true);
      setPanelsPacked([]);
      setPanelCountOverride(null);
      setRoofAxisHintDeg(null);
      setPanelAutoReadyKey(null);
      lastPanelAutoKeyRef.current = null;
      setCandidatePolygons(null);
      setAutoOutlineHint(null);

      if (mPerPx) {
        const axisDeg = polygonDominantEdgeAxisDeg(c.polygon);
        setOrientationDeg(bestRoofAlignedPackingOrientationDeg({ polygon: c.polygon, mPerPx, panelSpec, axisDeg }));
      }

      // If the candidates came from OSM disambiguation, refine the chosen building with CV
      // by locking the footprint + focusing an ROI.
      const dims =
        mapInput.kind === "image" && mapInput.image
          ? { w: mapInput.image.widthPx, h: mapInput.image.heightPx }
          : mapInput.kind === "address" && addressStatic
            ? { w: addressStatic.widthPx, h: addressStatic.heightPx }
            : null;
      if (!dims) return;

      const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
      const ring = c.polygon.map((p) => [clamp01(p.x / dims.w), clamp01(p.y / dims.h)]);
      const footprint = { type: "Polygon", coordinates: [ring] };

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of c.polygon) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pad = 18;
      const x = Math.max(0, Math.floor(minX - pad));
      const y = Math.max(0, Math.floor(minY - pad));
      const w = Math.max(1, Math.min(dims.w - x, Math.ceil(maxX - minX + pad * 2)));
      const h = Math.max(1, Math.min(dims.h - y, Math.ceil(maxY - minY + pad * 2)));

      void runAutoOutline({
        reason: "manual",
        roi: { x, y, w, h },
        metaOverride: {
          osmFootprint: footprint,
          osmSource: "user",
        },
      });
    },
    [addressStatic, candidatePolygons, mapInput.kind, mapInput.image, mPerPx, panelSpec, runAutoOutline]
  );

  const shareUrl = useMemo(() => {
    if (!shareSlug) return null;
    if (typeof window === "undefined") return null;
    return `${window.location.origin}/s/${shareSlug}`;
  }, [shareSlug]);

  const shareDisabledReason = !hasBackend
    ? "Sharing requires an external backend (/api/projects and /s/:shareSlug)."
    : !shareSlug
      ? "Create a project to enable sharing."
      : null;

  const leftPanel = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          Site
        </div>
        <button
          type="button"
          onClick={clearSite}
          className="rounded-full border border-border/70 bg-background/40 px-3 py-1 text-xs font-medium text-foreground transition hover:bg-background/60"
        >
          Clear
        </button>
      </div>

      <MapInput value={mapInput} onChange={setMapInput} compact={isMobile === false} />

      <div className="glass-card p-3">
        <div className="text-sm font-semibold text-foreground">
          Site + assumptions
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Latitude</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={lat ?? ""}
              onChange={(e) => setLat(coerceNumber(e.target.value))}
              placeholder="34.0522"
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Longitude</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={lng ?? ""}
              onChange={(e) => setLng(coerceNumber(e.target.value))}
              placeholder="-118.2437"
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Tilt (deg)</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={tiltDeg}
              onChange={(e) => setTiltDeg(Number(e.target.value) || 0)}
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Azimuth (deg)</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={azimuthDeg}
              onChange={(e) => setAzimuthDeg(Number(e.target.value) || 0)}
              inputMode="decimal"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted-foreground">Losses (%)</div>
            <input
              className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
              value={lossesPct}
              onChange={(e) => setLossesPct(Number(e.target.value) || 0)}
              inputMode="decimal"
            />
          </label>
        </div>
      </div>

      <RoofCanvas
        key={
          background.kind === "image"
            ? `img:${background.src}:${background.widthPx}x${background.heightPx}`
            : background.kind
        }
        containerClassName="h-[250px] sm:h-[300px] lg:h-[min(30vh,320px)] xl:h-[min(34vh,360px)]"
        background={background}
        mPerPx={mPerPx}
        orientationDeg={orientationDeg}
        panelSpec={panelSpec}
        vertices={vertices}
        closed={closed}
        panels={panels}
        onVerticesChange={(v) => {
          setVertices(v);
          setPanelCountOverride(null);
          setPanelsPacked([]);
          setRoofAxisHintDeg(null);
          setPanelAutoReadyKey(null);
          lastPanelAutoKeyRef.current = null;
          setCandidatePolygons(null);
          setAutoOutlineError(null);
          setAutoOutlineHint(null);
          if (v.length < 3) setClosed(false);
          if (v.length === 0) {
            setCandidatePolygons(null);
            setAutoOutlineHint(null);
            setAutoOutlineError(null);
            setRoofAxisHintDeg(null);
            setPanelAutoReadyKey(null);
            lastPanelAutoKeyRef.current = null;
          }
        }}
        onClosedChange={setClosed}
        onAutoOutline={(o?: { roi?: { x: number; y: number; w: number; h: number } | null }) => {
          void runAutoOutline({ reason: "manual", roi: o?.roi ?? null });
        }}
        autoOutlineBusy={autoOutlineBusy}
        autoOutlineError={autoOutlineError}
        autoOutlineHint={autoOutlineHint}
        candidatePolygons={candidatePolygons}
        onPickCandidate={pickCandidate}
        centerPin={
          addressStatic
            ? { x: addressStatic.widthPx / 2, y: addressStatic.heightPx / 2 }
            : null
        }
      />

      <div className="glass-card p-3">
        <div className="text-sm font-semibold text-foreground">Orientation</div>
        <label className="mt-3 block space-y-1">
          <div className="text-xs text-muted-foreground">Orientation (deg)</div>
          <input
            type="range"
            min={-90}
            max={90}
            step={1}
            value={orientationDeg}
            onChange={(e) => setOrientationDeg(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-xs text-muted-foreground">{orientationDeg}°</div>
        </label>
      </div>
    </div>
  );

  const rightPanel = (
    <div className="space-y-3">
      <SolarForecastCard
        className="glass-card p-3"
        lat={lat}
        lng={lng}
        dcKw={dcKw}
        lossesPct={lossesPct}
        panelCount={panelCount}
      />

      <div className="glass-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">Results</div>
          <div className="text-xs text-muted-foreground">
            {estimate.source === "server" ? "Server estimate" : "Fallback"}
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Panels</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={panelCount} />
            </div>
          </div>
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">DC kW</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={dcKw} formatFn={(n) => n.toFixed(1)} />
            </div>
          </div>
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Annual kWh</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={estimate.annualKwh} />
            </div>
          </div>
          <div className="stagger-item gradient-border glass-surface rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Annual CO₂ (kg)</div>
            <div className="mt-1 text-lg font-semibold text-foreground text-glow">
              <AnimatedNumber value={estimate.annualCo2Kg} />
            </div>
          </div>
        </div>

        <div className="glass-surface mt-3 rounded-lg p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-foreground">Panel model</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {panelChoiceLabel} • {panelSpecMode === "auto" ? "auto" : "locked"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={() => {
                  setPanelSpecMode((m) => (m === "auto" ? "manual" : "auto"))
                  setPanelBrandRec(null)
                  setPanelBrandError(null)
                  lastPanelAutoKeyRef.current = null
                }}
                title={panelSpecMode === "auto" ? "Lock panel model selection" : "Switch back to auto selection"}
              >
                {panelSpecMode === "auto" ? "Lock" : "Auto"}
              </button>
              <button
                type="button"
                className="rounded-md bg-secondary px-3 py-1.5 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                onClick={() => {
                  setPanelBrandRec(null)
                  setPanelBrandError(null)
                  setPanelBrandReqSeq((s) => s + 1)
                }}
                disabled={panelCount === 0}
                title="Re-run Gemini recommendation"
              >
                {panelBrandBusy ? "Gemini…" : "Ask Gemini"}
              </button>
            </div>
          </div>

          {panelBrandRec && (
            <div className="mt-2 text-xs text-muted-foreground">
              <div className="text-foreground">
                Gemini pick: <span className="font-medium">{panelBrandRec.brand}</span> — {panelBrandRec.model}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Source:{" "}
                {panelBrandRec.source.kind === "fallback"
                  ? "Local fallback"
                  : panelBrandRec.source.usedModel
                    ? `Gemini (${panelBrandRec.source.usedModel})`
                    : "Gemini"}
              </div>
              <div className="mt-1 text-[11px]">
                Panel info: <a className="underline underline-offset-2 hover:no-underline" href={panelBrandRec.sourceUrl} target="_blank" rel="noreferrer">{panelBrandRec.sourceUrl}</a>
              </div>
              {panelBrandRec.source.kind === "fallback" && panelBrandRec.source.fallbackReason ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Reason: {panelBrandRec.source.fallbackReason}
                </div>
              ) : null}
              {panelBrandRec.why?.length ? (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {panelBrandRec.why.slice(0, 3).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {panelBrandError && (
            <div className="mt-2 text-xs text-muted-foreground">
              Gemini unavailable: <span className="text-muted-foreground">{panelBrandError}</span>
            </div>
          )}
          {panelBrandRec?.caveats?.length ? (
            <div className="mt-2 text-[11px] text-muted-foreground">
              {panelBrandRec.caveats.slice(0, 2).join(" ")}
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={runExplain}
            disabled={explainLoading || panelCount === 0}
          >
            {explainLoading ? "Explaining…" : "Explain"}
          </button>
          <button
            type="button"
            className="rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            onClick={runTalk}
            disabled={ttsLoading || panelCount === 0}
          >
            {ttsLoading ? "Talking…" : "Talk"}
          </button>
          <button
            type="button"
            className="rounded-md bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            onClick={() => setShowShare((s) => !s)}
            disabled={shareDisabledReason !== null}
            title={shareDisabledReason ?? "Share"}
          >
            Share
          </button>
        </div>

        {!hasBackend && hasLocalElevenLabsKey === false && (
          <button
            type="button"
            onClick={returnToLanding}
            className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground hover:no-underline"
          >
            Add ElevenLabs key on landing to enable Talk
          </button>
        )}

        {(actionNotice || shareDisabledReason) && (
          <div className="mt-2 text-xs text-muted-foreground">
            {actionNotice ?? shareDisabledReason}
          </div>
        )}

        {explainText && (
          <div className="glass-surface mt-3 rounded-lg p-3 text-sm text-foreground">
            <ul className="list-disc space-y-1 pl-5">
              {explainText.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-muted-foreground">
              {explainText.caveat}
            </div>
          </div>
        )}
      </div>

      <div className="glass-card p-3">
        <div className="text-sm font-semibold text-foreground">
          Panel packing
        </div>
        <div className="mt-3 grid gap-3">
          <div className="glass-surface rounded-lg p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-foreground">Panels (count)</div>
              <button
                type="button"
                className="rounded-md bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                onClick={() => setPanelCountOverride(null)}
                disabled={panelCountOverride === null}
                title="Reset to auto"
              >
                Auto
              </button>
            </div>

            <div className="mt-2 grid grid-cols-[1fr,92px] items-center gap-2">
              <input
                type="range"
                min={0}
                max={Math.max(0, panelCountAuto)}
                step={1}
                value={manualPanelCount}
                onChange={(e) => setManualPanelCount(Number(e.target.value))}
                className="w-full"
                disabled={panelCountAuto <= 0}
              />
              <input
                className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
                value={manualPanelCount}
                onChange={(e) => setManualPanelCount(Number(e.target.value))}
                inputMode="numeric"
                disabled={panelCountAuto <= 0}
              />
            </div>

            <div className="mt-1 text-[11px] text-muted-foreground">
              Auto fits {panelCountAuto}. Manual resets when you edit the roof or search a new address.
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <BackgroundScene mode={sceneMode} transitionMs={900} />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,20,0.10)_0%,rgba(3,8,20,0.14)_42%,rgba(3,8,20,0.28)_100%)]" />

      <GlobeStage
        lat={lat}
        lng={lng}
        interactive={globeInteractive}
        onPrimaryClick={opened || settingsOpen ? undefined : openApp}
        onPickLocation={pickEnabled ? handlePickLocation : undefined}
        onReadyChange={setGlobeBootReady}
        dim={opened && !settingsOpen}
        className={cn(
          "z-[2] transition-transform duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
          !opened && !settingsOpen
            ? "lg:translate-x-[7vw] lg:scale-[1.06] xl:translate-x-[9vw]"
            : "translate-x-0 scale-100",
        )}
      />

      {startupDone && !settingsOpen && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-[3] transition-opacity duration-700 motion-reduce:duration-0",
            opened ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="dashboard-scrim dashboard-scrim-left absolute inset-y-0 left-0 hidden w-[34vw] lg:block" />
          <div className="dashboard-scrim dashboard-scrim-right absolute inset-y-0 right-0 hidden w-[28vw] lg:block" />
          <div className="dashboard-scrim dashboard-scrim-bottom absolute inset-x-0 bottom-0 h-[24vh] lg:hidden" />
        </div>
      )}

      {startupDone && !settingsOpen && (
        <div ref={topChromeRef} className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3 sm:top-4">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-border/55 bg-background/25 p-1.5 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.95)] backdrop-blur-md">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/45 bg-primary/12 px-3 py-1.5 shadow-[0_10px_30px_-22px_rgba(0,0,0,0.95)]">
              <span className="text-[10px] font-semibold tracking-[0.24em] text-foreground uppercase">
                Sunnyview
              </span>
            </div>

            {phase === "app" && (
              <button
                type="button"
                onClick={returnToLanding}
                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/45 px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-background/65"
              >
                <ArrowLeft size={14} />
                Back to landing
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowShare(false);
                setHistoryOpen(true);
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold text-foreground shadow-[0_12px_28px_-16px_rgba(0,0,0,0.95)] backdrop-blur-sm transition",
                historyOpen
                  ? "border-primary/70 bg-primary/26"
                  : "border-primary/60 bg-primary/14 hover:bg-primary/22",
              )}
            >
              <History size={14} />
              History
            </button>

            <button
              type="button"
              onClick={() => {
                setShowShare(false);
                setHistoryOpen(false);
                setSettingsOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-primary/65 bg-primary/18 px-4 py-1.5 text-xs font-semibold text-foreground shadow-[0_12px_28px_-16px_rgba(0,0,0,0.95)] backdrop-blur-sm transition hover:bg-primary/28"
            >
              <Settings2 size={14} />
              Settings
            </button>
          </div>
        </div>
      )}

      {startupDone && !settingsOpen && (
        <div className="pointer-events-none relative z-20 mx-auto h-full w-full max-w-[1820px] px-4 py-2 sm:px-6 sm:py-3 lg:px-10 lg:py-3 xl:px-14">
          {isMobile === null ? null : !isMobile ? (
            <div
              className={cn(
                "grid h-full min-h-0 grid-cols-1 gap-3",
                opened
                  ? "lg:grid-cols-[minmax(330px,420px)_minmax(0,1fr)_minmax(330px,420px)] xl:grid-cols-[minmax(350px,440px)_minmax(0,1fr)_minmax(350px,440px)]"
                  : "lg:grid-cols-[minmax(320px,460px)_minmax(0,1fr)] xl:grid-cols-[minmax(340px,480px)_minmax(0,1fr)]",
              )}
            >
              <aside className="pointer-events-auto relative min-h-0 transition-[opacity,transform] duration-[800ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0">
                <div className="absolute inset-0 h-full min-h-0 overflow-x-hidden overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <div
                    className={cn(
                      "transition-[opacity,transform] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                      entered && !opened
                        ? "translate-x-0 opacity-100 duration-[900ms]"
                        : "pointer-events-none -translate-x-8 opacity-0 duration-[220ms]",
                    )}
                  >
                    <HeroSection
                      onStart={openApp}
                      visible={entered && !opened}
                    />
                  </div>
                </div>

                <div
                  className={cn(
                    "absolute inset-0 h-full min-h-0 overflow-x-hidden overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                    "transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                    opened
                      ? opening
                        ? "translate-x-0 opacity-100 delay-[90ms]"
                        : "translate-x-0 opacity-100 delay-0"
                      : "pointer-events-none -translate-x-10 opacity-0 delay-0",
                  )}
                >
                  {panelsMounted ? leftPanel : null}
                </div>
              </aside>

              <div className="hidden min-h-0 lg:block" />

              {opened ? (
                <aside className="pointer-events-auto min-h-0 transition-[opacity,transform] duration-[800ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0">
                  <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto pl-1">
                    <div
                      className={cn(
                        "transition-[opacity,transform] duration-[900ms] ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0",
                        opening
                          ? "translate-x-0 opacity-100 delay-[130ms]"
                          : "translate-x-0 opacity-100 delay-0",
                      )}
                    >
                      {panelsMounted ? rightPanel : null}
                    </div>
                  </div>
                </aside>
              ) : null}
            </div>
          ) : (
            <div className="relative h-full pt-14">
              <div
                className={cn(
                  "pointer-events-auto h-full overflow-auto pr-1 transition-opacity duration-500 motion-reduce:duration-0",
                  opened ? "pointer-events-none opacity-0" : "opacity-100",
                )}
              >
                <HeroSection onStart={openApp} visible={entered && !opened} />
              </div>

              {opened ? (
                <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.85,0.2,1)] motion-reduce:duration-0">
                  <div className="glass-card mx-1 mb-2 overflow-hidden rounded-2xl">
                    <div className="flex items-center gap-2 border-b border-border/60 p-2">
                      <button
                        type="button"
                        onClick={() => setMobilePane("setup")}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition",
                          mobilePane === "setup"
                            ? "bg-primary/18 text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Setup
                      </button>
                      <button
                        type="button"
                        onClick={() => setMobilePane("results")}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-xs font-medium transition",
                          mobilePane === "results"
                            ? "bg-primary/18 text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Results
                      </button>
                    </div>

                    <div className="max-h-[68vh] overflow-auto p-3">
                      {panelsMounted
                        ? mobilePane === "setup"
                          ? leftPanel
                          : rightPanel
                        : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {!startupDone && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-background">
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_38%,rgba(11,20,40,0.85)_0%,rgba(6,10,22,0.92)_42%,rgba(0,0,0,0.98)_100%)]"
          />
          <SunnyviewLogoLoader className="relative z-[1]" />
        </div>
      )}

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onLoadSnapshot={loadHistorySnapshot}
        onNotice={setActionNotice}
      />

      {settingsOpen && (
        <div className="absolute inset-0 z-40">
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
            className="absolute inset-0 bg-black/35 backdrop-blur-[1px]"
          />
          <div className="relative z-10 flex h-full items-start justify-center overflow-auto px-2 py-6 sm:px-4 sm:py-8">
            <SettingsPage embedded onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}

      {showShare && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="glass-card w-full max-w-md p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">Share</div>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => setShowShare(false)}
              >
                Close
              </button>
            </div>
            <div className="glass-surface mt-3 rounded-lg p-4">
              {shareUrl ? (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Public link</div>
                  <div className="glass-surface break-all rounded-md p-2 text-xs text-foreground">
                    {shareUrl}
                  </div>
                  <button
                    type="button"
                    className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareUrl);
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    Copy link
                  </button>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Share link not available yet.
                </div>
              )}
            </div>
            {shareSlug && (
              <div className="mt-3 text-xs text-muted-foreground">
                Share slug: <span className="text-foreground">{shareSlug}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
