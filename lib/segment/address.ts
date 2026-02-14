function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function normStreet(s: string) {
  const tokens = norm(s).split(" ")
  const expanded = tokens.map((t) => {
    switch (t) {
      case "st":
        return "street"
      case "rd":
        return "road"
      case "dr":
        return "drive"
      case "ave":
        return "avenue"
      case "blvd":
        return "boulevard"
      case "hwy":
        return "highway"
      case "pkwy":
        return "parkway"
      case "ln":
        return "lane"
      case "ct":
        return "court"
      case "pl":
        return "place"
      case "trl":
        return "trail"
      case "cir":
        return "circle"
      default:
        return t
    }
  })
  return expanded.join(" ").trim()
}

export type AddressHints = {
  raw: string
  houseNumber: string | null
  streetNorm: string | null
}

export function parseAddressHints(address: string | null | undefined): AddressHints | null {
  const raw = (address ?? "").trim()
  if (!raw) return null
  const m = raw.match(/^(\d{1,8})\b/)
  const houseNumber = m ? m[1] : null
  const rest = raw.replace(/^(\d{1,8})\s+/, "").trim()
  const streetPart = rest.split(",")[0]?.trim() ?? ""
  const streetNorm = streetPart ? normStreet(streetPart) : null
  return { raw, houseNumber, streetNorm }
}

export function scoreAddrMatch(tags: Record<string, string>, hints: AddressHints | null) {
  if (!hints) return 0
  const hn = tags["addr:housenumber"]?.trim() ?? ""
  const st = tags["addr:street"]?.trim() ?? ""
  let score = 0
  if (hints.houseNumber && hn && norm(hn) === norm(hints.houseNumber)) score += 2
  if (hints.streetNorm && st) {
    const stNorm = normStreet(st)
    if (stNorm === hints.streetNorm) score += 1
    else if (stNorm.includes(hints.streetNorm) || hints.streetNorm.includes(stNorm)) score += 0.5
  }
  return score
}
