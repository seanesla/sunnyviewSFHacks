import { NextResponse } from 'next/server'
import { z } from 'zod'

const SegmentRequestSchema = z.object({
  imageRef: z.string(),
})

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SegmentRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  return NextResponse.json({
    roofPolygon: {
      type: 'Polygon',
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    },
    confidence: 0.5,
    note: 'This is a stub for testing.',
  })
}
