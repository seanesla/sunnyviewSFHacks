import { NextResponse } from 'next/server'
import { z } from 'zod'

const ExplainRequestSchema = z.object({
  estimate: z.object({
    annualKwh: z.number(),
    co2: z.number(),
  }),
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

  return NextResponse.json({
    bullets: [
      'Great solar potential!',
      'Estimated $1,200 savings',
      'Reduces carbon footprint',
    ],
    shortParagraph: 'Based on your roof size, this system covers 90% of your needs.',
    caveats: ['This is a rough estimate.', 'Shading not calculated.'],
  })
}
