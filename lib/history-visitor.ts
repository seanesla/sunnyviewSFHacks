import { randomUUID } from "crypto"

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

const DEFAULT_COOKIE_NAME = "sv_vid"
const DEFAULT_COOKIE_MAX_AGE_DAYS = 365
const VISITOR_ID_RE = /^[a-zA-Z0-9_-]{16,120}$/

export type VisitorCookieContext = {
  visitorId: string
  cookieName: string
  shouldSetCookie: boolean
}

function cookieName() {
  const raw = process.env.HISTORY_COOKIE_NAME?.trim()
  return raw && raw.length > 0 ? raw : DEFAULT_COOKIE_NAME
}

function cookieMaxAgeSec() {
  const raw = Number(process.env.HISTORY_COOKIE_MAX_AGE_DAYS ?? "")
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COOKIE_MAX_AGE_DAYS
  return Math.round(days * 24 * 60 * 60)
}

function newVisitorId() {
  return `v_${randomUUID().replaceAll("-", "")}`
}

export function getOrCreateVisitorContext(req: NextRequest): VisitorCookieContext {
  const name = cookieName()
  const existing = req.cookies.get(name)?.value?.trim() ?? ""
  if (VISITOR_ID_RE.test(existing)) {
    return { visitorId: existing, cookieName: name, shouldSetCookie: false }
  }
  return { visitorId: newVisitorId(), cookieName: name, shouldSetCookie: true }
}

export function attachVisitorCookie(res: NextResponse, visitor: VisitorCookieContext) {
  if (!visitor.shouldSetCookie) return res

  res.cookies.set({
    name: visitor.cookieName,
    value: visitor.visitorId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookieMaxAgeSec(),
  })

  return res
}
