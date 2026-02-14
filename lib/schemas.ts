import { z } from "zod";

export const SiteSpecSchema = z.object({
  lat: z.number().optional(),
  lng: z.number().optional(),
  tiltDeg: z.number().default(20),
  azimuthDeg: z.number().default(180),
  lossesPct: z.number().default(14),
});

export const PanelSpecSchema = z.object({
  lengthM: z.number().default(1.7),
  widthM: z.number().default(1.1),
  wattW: z.number().default(400),
  gapM: z.number().default(0.02),
  setbackM: z.number().default(0.3),
});

export const ProjectCreateSchema = z.object({
  title: z.string().default("Untitled"),
  baseImage: z.object({
    kind: z.enum(["upload", "tile"]),
    url: z.string().optional(),
    objectKey: z.string().optional(),
    sha256: z.string().optional(),
  }),
  siteSpec: SiteSpecSchema.optional(),
  panelSpec: PanelSpecSchema.optional(),
});

export const ProjectPatchSchema = z.object({
  title: z.string().optional(),
  baseImage: z.any().optional(),
  siteSpec: SiteSpecSchema.partial().optional(),
  panelSpec: PanelSpecSchema.partial().optional(),
  geometry: z.any().optional(), // FE can store GeoJSON-like shapes here
  results: z.any().optional(), // annualKwh, co2, assumptions, etc.
});