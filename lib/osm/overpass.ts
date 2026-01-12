import "server-only"

export type OverpassPoi = {
  name: string
  type: string
  lat: number
  lon: number
}

export type OverpassTaggedPoi = {
  name: string
  type: string | null
  lat: number
  lon: number
  tags: Record<string, string>
}

type OverpassElement = {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
const DEFAULT_TIMEOUT_MS = 15000
const MAX_RETRIES = 2

export async function fetchOverpassPois(
  lat: number,
  lon: number,
  radiusMeters: number
): Promise<OverpassPoi[]> {
  const query = buildOverpassQuery(lat, lon, radiusMeters)
  const url = process.env.OVERPASS_BASE_URL || DEFAULT_OVERPASS_URL

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "ia-maps-app" },
        body: query,
        cache: "no-store",
      })

      if (!response.ok) {
        throw new Error(`Overpass HTTP ${response.status}`)
      }

      const data = (await response.json()) as { elements?: OverpassElement[] }
      return normalizeOverpass(data?.elements ?? [])
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass error")
      if (attempt < MAX_RETRIES) {
        await wait(400 * (attempt + 1))
      }
    }
  }

  throw lastError ?? new Error("Overpass error")
}

export async function fetchOverpassPoisByTags(
  lat: number,
  lon: number,
  radiusMeters: number,
  tags: string[]
): Promise<OverpassTaggedPoi[]> {
  const filters = parseTagFilters(tags)
  if (filters.length === 0) return []

  const query = buildOverpassQueryForTags(lat, lon, radiusMeters, filters)
  const url = process.env.OVERPASS_BASE_URL || DEFAULT_OVERPASS_URL

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "ia-maps-app" },
        body: query,
        cache: "no-store",
      })

      if (!response.ok) {
        throw new Error(`Overpass HTTP ${response.status}`)
      }

      const data = (await response.json()) as { elements?: OverpassElement[] }
      return normalizeOverpassWithTags(data?.elements ?? [], filters)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Overpass error")
      if (attempt < MAX_RETRIES) {
        await wait(400 * (attempt + 1))
      }
    }
  }

  throw lastError ?? new Error("Overpass error")
}

function buildOverpassQuery(lat: number, lon: number, radiusMeters: number) {
  return `
[out:json][timeout:25];
(
  node["amenity"~"restaurant|fast_food|bar|pub|nightclub|cafe|pharmacy|hospital|clinic|doctors|school|college|university|bus_station"](around:${radiusMeters},${lat},${lon});
  node["shop"="supermarket"](around:${radiusMeters},${lat},${lon});
  node["tourism"~"hotel|hostel|guest_house|attraction|museum|viewpoint"](around:${radiusMeters},${lat},${lon});
  node["highway"="bus_stop"](around:${radiusMeters},${lat},${lon});
  node["public_transport"~"platform|station"](around:${radiusMeters},${lat},${lon});

  way["amenity"~"restaurant|fast_food|bar|pub|nightclub|cafe|pharmacy|hospital|clinic|doctors|school|college|university|bus_station"](around:${radiusMeters},${lat},${lon});
  way["shop"="supermarket"](around:${radiusMeters},${lat},${lon});
  way["tourism"~"hotel|hostel|guest_house|attraction|museum|viewpoint"](around:${radiusMeters},${lat},${lon});
  way["highway"="bus_stop"](around:${radiusMeters},${lat},${lon});
  way["public_transport"~"platform|station"](around:${radiusMeters},${lat},${lon});

  relation["amenity"~"restaurant|fast_food|bar|pub|nightclub|cafe|pharmacy|hospital|clinic|doctors|school|college|university|bus_station"](around:${radiusMeters},${lat},${lon});
  relation["shop"="supermarket"](around:${radiusMeters},${lat},${lon});
  relation["tourism"~"hotel|hostel|guest_house|attraction|museum|viewpoint"](around:${radiusMeters},${lat},${lon});
  relation["highway"="bus_stop"](around:${radiusMeters},${lat},${lon});
  relation["public_transport"~"platform|station"](around:${radiusMeters},${lat},${lon});
);
out center 120;
`
}

type OverpassTagFilter = {
  key: string
  operator: "=" | "~"
  value: string
}

function buildOverpassQueryForTags(
  lat: number,
  lon: number,
  radiusMeters: number,
  filters: OverpassTagFilter[]
) {
  const filterString = filters
    .map((filter) => `["${filter.key}"${filter.operator}"${filter.value}"]`)
    .join("")

  return `
[out:json][timeout:25];
(
  node${filterString}(around:${radiusMeters},${lat},${lon});
  way${filterString}(around:${radiusMeters},${lat},${lon});
  relation${filterString}(around:${radiusMeters},${lat},${lon});
);
out center 120;
`
}

function parseTagFilters(tags: string[]): OverpassTagFilter[] {
  return tags
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const normalized = raw.replace(/\s+/g, "")
      const hasRegex = normalized.includes("~")
      const [keyPart, valuePart] = normalized.split(hasRegex ? "~" : "=")
      if (!keyPart || !valuePart) return null
      const key = sanitizeKey(keyPart)
      const value = sanitizeValue(valuePart)
      if (!key || !value) return null
      const operator =
        hasRegex || value.includes("|") || value.includes("*") ? "~" : "="
      return { key, operator, value }
    })
    .filter((item): item is OverpassTagFilter => Boolean(item))
}

function sanitizeKey(value: string) {
  const match = value.match(/^[a-zA-Z0-9:_-]+$/)
  return match ? value : null
}

function sanitizeValue(value: string) {
  const cleaned = value.replace(/"/g, "")
  return cleaned.length > 0 ? cleaned : null
}

function normalizeOverpass(elements: OverpassElement[]): OverpassPoi[] {
  return elements
    .map((element) => {
      const tags = element.tags ?? {}
      const type = inferType(tags)
      if (!type) return null

      const lat = element.lat ?? element.center?.lat
      const lon = element.lon ?? element.center?.lon
      if (typeof lat !== "number" || typeof lon !== "number") return null

      const name = buildDisplayName(tags, type)
      if (!name) return null

      return {
        name,
        type,
        lat,
        lon,
      }
    })
    .filter((item): item is OverpassPoi => Boolean(item))
}

function normalizeOverpassWithTags(
  elements: OverpassElement[],
  filters: OverpassTagFilter[]
): OverpassTaggedPoi[] {
  return elements
    .map((element) => {
      const tags = element.tags ?? {}
      const lat = element.lat ?? element.center?.lat
      const lon = element.lon ?? element.center?.lon
      if (typeof lat !== "number" || typeof lon !== "number") return null

      const type = pickTypeFromTags(tags, filters)
      const name = buildDisplayName(tags, type ?? "Lugar")
      if (!name) return null

      return {
        name,
        type,
        lat,
        lon,
        tags,
      }
    })
    .filter((item): item is OverpassTaggedPoi => Boolean(item))
}

function pickTypeFromTags(
  tags: Record<string, string>,
  filters: OverpassTagFilter[]
) {
  if (tags.cuisine) return tags.cuisine
  if (tags.shop) return tags.shop
  if (tags.amenity) return tags.amenity
  if (tags.leisure) return tags.leisure
  if (tags.tourism) return tags.tourism

  for (const filter of filters) {
    const value = tags[filter.key]
    if (value) return value
  }

  return null
}

function inferType(tags: Record<string, string>) {
  const amenity = tags.amenity
  const tourism = tags.tourism
  const shop = tags.shop
  const highway = tags.highway
  const publicTransport = tags.public_transport

  if (amenity === "restaurant") return "restaurant"
  if (amenity === "fast_food") return "fast_food"
  if (amenity === "bar" || amenity === "pub") return "bar"
  if (amenity === "nightclub") return "club"
  if (amenity === "cafe") return "cafe"
  if (amenity === "pharmacy") return "pharmacy"
  if (amenity === "hospital" || amenity === "clinic" || amenity === "doctors") {
    return "hospital"
  }
  if (amenity === "school" || amenity === "college" || amenity === "university") {
    return "school"
  }
  if (amenity === "bus_station") return "bus_stop"
  if (shop === "supermarket") return "supermarket"
  if (highway === "bus_stop") return "bus_stop"
  if (publicTransport === "platform" || publicTransport === "station") {
    return "bus_stop"
  }
  if (tourism === "hotel" || tourism === "hostel" || tourism === "guest_house") {
    return "hotel"
  }
  if (tourism === "attraction") return "attraction"
  if (tourism === "museum") return "museum"
  if (tourism === "viewpoint") return "viewpoint"

  return null
}

function buildDisplayName(tags: Record<string, string>, type: string) {
  const name = tags.name || tags.brand || tags.operator
  if (name && name.trim()) return name.trim()

  const label = fallbackTypeLabel(type)
  return label ? `${label} (sin nombre)` : null
}

function fallbackTypeLabel(type: string) {
  switch (type) {
    case "restaurant":
      return "Restaurante"
    case "fast_food":
      return "Fast food"
    case "bar":
      return "Bar"
    case "club":
      return "Club"
    case "cafe":
      return "Cafe"
    case "bakery":
      return "Panaderia"
    case "confectionery":
      return "Pasteleria"
    case "butcher":
      return "Carniceria"
    case "seafood":
      return "Pescaderia"
    case "greengrocer":
      return "Fruteria"
    case "hardware":
      return "Ferreteria"
    case "books":
      return "Libreria"
    case "stationery":
      return "Papeleria"
    case "clothes":
      return "Tienda de ropa"
    case "shoes":
      return "Zapateria"
    case "florist":
      return "Floristeria"
    case "hairdresser":
      return "Peluqueria"
    case "tobacco":
      return "Estanco"
    case "fuel":
      return "Gasolinera"
    case "parking":
      return "Parking"
    case "bank":
      return "Banco"
    case "atm":
      return "Cajero"
    case "fitness_centre":
      return "Gimnasio"
    case "pharmacy":
      return "Farmacia"
    case "hospital":
      return "Hospital"
    case "school":
      return "Colegio"
    case "supermarket":
      return "Supermercado"
    case "bus_stop":
      return "Parada de bus"
    case "hotel":
      return "Hotel"
    case "attraction":
      return "Atraccion"
    case "museum":
      return "Museo"
    case "viewpoint":
      return "Mirador"
    default:
      return null
  }
}

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
