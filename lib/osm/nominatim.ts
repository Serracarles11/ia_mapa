import "server-only"

export type NominatimForwardResult = {
  lat: number
  lon: number
  display_name: string
  importance?: number
  type?: string
  category?: string
}

export type NominatimReverseResult = {
  name: string | null
  display_name: string | null
  category: string | null
  type: string | null
  address_line?: string | null
  municipality?: string | null
  address?: {
    house_number: string | null
    road: string | null
    neighbourhood: string | null
    suburb: string | null
    city_district: string | null
    county: string | null
    state: string | null
    state_district: string | null
    region: string | null
    postcode: string | null
    country: string | null
  }
}

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org"
const USER_AGENT = "ia-maps-app"

export async function forwardGeocode(
  query: string
): Promise<NominatimForwardResult | null> {
  const baseUrl = process.env.NOMINATIM_BASE_URL || DEFAULT_BASE_URL
  const url = new URL("/search", baseUrl)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "1")
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("accept-language", "es")

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as unknown
  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  const item = data[0]
  if (!isRecord(item)) return null

  const lat = parseNumber(item.lat)
  const lon = parseNumber(item.lon)
  const displayName = getString(item.display_name)
  if (lat == null || lon == null || !displayName) return null

  return {
    lat,
    lon,
    display_name: displayName,
    importance: getNumber(item.importance) ?? undefined,
    type: getString(item.type) ?? undefined,
    category: getString(item.class) ?? getString(item.category) ?? undefined,
  }
}

export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<NominatimReverseResult | null> {
  const baseUrl = process.env.NOMINATIM_BASE_URL || DEFAULT_BASE_URL
  const url = new URL("/reverse", baseUrl)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lon", String(lon))
  url.searchParams.set("addressdetails", "1")
  url.searchParams.set("accept-language", "es")

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  })

  if (!response.ok) {
    return null
  }

  const data = (await response.json()) as unknown
  if (!isRecord(data)) return null

  const address = isRecord(data.address) ? data.address : null
  const nameFromAddress = address ? getString(address.road) : null
  const municipality =
    address &&
    (getString(address.municipality) ||
      getString(address.city) ||
      getString(address.town) ||
      getString(address.village) ||
      getString(address.county))

  return {
    name: getString(data.name) || nameFromAddress || null,
    display_name: getString(data.display_name) || null,
    category: getString(data.category) || getString(data.class) || null,
    type: getString(data.type) || null,
    address_line: getString(data.display_name) || null,
    municipality: municipality ?? null,
    address: address
      ? {
          house_number: getString(address.house_number),
          road: getString(address.road),
          neighbourhood: getString(address.neighbourhood),
          suburb: getString(address.suburb),
          city_district: getString(address.city_district),
          county: getString(address.county),
          state: getString(address.state),
          state_district: getString(address.state_district),
          region: getString(address.region),
          postcode: getString(address.postcode),
          country: getString(address.country),
        }
      : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
