import { NextResponse } from 'next/server'
import { z } from 'zod'

const ExplainRequestSchema = z.object({
  estimate: z.object({
    annualKwh: z.number(),
    annualCo2Kg: z.number().optional(),
    co2: z.number().optional(),
  }),
  assumptions: z.unknown().optional(),
  userGoal: z.string().optional(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ExplainRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const annualKwh = parsed.data.estimate.annualKwh
  const annualCo2Kg = parsed.data.estimate.annualCo2Kg ?? parsed.data.estimate.co2 ?? 0

  const bullets = [
    `Estimated annual production is about ${Math.round(annualKwh).toLocaleString()} kWh.`,
    `Estimated annual CO2 avoided is about ${Math.round(annualCo2Kg).toLocaleString()} kg.`,
    'Actual performance can improve or drop based on shading, roof orientation, and local weather.',
  ]

  const caveat =
    'This is an early-stage estimate and should be validated with detailed shading and site analysis.'

  return NextResponse.json({
    bullets,
    caveat,
    caveats: [caveat],
  })
}
