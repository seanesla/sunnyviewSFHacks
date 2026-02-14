import { NextResponse } from "next/server";
import { z } from "zod";

// Input Schema: What the frontend sends you
const EstimateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  panelCount: z.number(),
  tilt: z.number().default(20),
  azimuth: z.number().default(180),
});

export async function POST(req: Request) {
  // 1. Validate Input
  const body = await req.json().catch(() => ({}));
  const parsed = EstimateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Data", details: parsed.error }, { status: 400 });
  }

  const { panelCount, lat } = parsed.data;

  // 2. STUB LOGIC (Replace this with real NREL/PVWatts later)
  // Simple formula: 400W panel * count * 1.5 sun-hours factor * 365 days
  const systemKw = (panelCount * 400) / 1000;
  const estimatedAnnualKwh = systemKw * 4.5 * 365; 
  const co2SavedKg = estimatedAnnualKwh * 0.38; // approx factor

  // 3. Return JSON
  return NextResponse.json({
    systemSizeKw: systemKw,
    annualKwh: Math.round(estimatedAnnualKwh),
    co2SavedKg: Math.round(co2SavedKg),
    monthlyProduction: Array(12).fill(Math.round(estimatedAnnualKwh / 12)), // Fake monthly data
  });
}