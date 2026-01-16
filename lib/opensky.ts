import "server-only"

export type AircraftState = {
  id: string
  callsign: string | null
  origin_country: string | null
  lat: number
  lon: number
  altitude_m: number | null
  velocity_mps: number | null
  heading_deg: number | null
  on_ground: boolean
  last_contact: number | null
  time_position: number | null
}

export type AircraftResponse = {
  ok: boolean
  mode: "live" | "demo"
  source: string
  time: number | null
  flights: AircraftState[]
  notice?: string
  rate_limited?: boolean
  refresh_ms?: number
}

const DEFAULT_ENDPOINT = "https://opensky-network.org/api/states/all"
const CACHE_TTL_MS = 5000
const cache = new Map<string, { expiresAt: number; payload: AircraftResponse }>()

export async function fetchAircraftStates(
  lat: number,
  lon: number,
  radius_m: number
): Promise<AircraftResponse> {
  const flightRadius = Math.min(Math.max(radius_m * 4, 25000), 120000)
  const bbox = buildBoundingBox(lat, lon, flightRadius)
  const cacheKey = `${bbox.minLat.toFixed(2)}:${bbox.minLon.toFixed(2)}:${bbox.maxLat.toFixed(2)}:${bbox.maxLon.toFixed(2)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload
  }

  const endpoint = process.env.OPEN_SKY_ENDPOINT || DEFAULT_ENDPOINT
  const url = new URL(endpoint)
  url.searchParams.set("lamin", bbox.minLat.toFixed(4))
  url.searchParams.set("lomin", bbox.minLon.toFixed(4))
  url.searchParams.set("lamax", bbox.maxLat.toFixed(4))
  url.searchParams.set("lomax", bbox.maxLon.toFixed(4))

  const headers: Record<string, string> = {
    "User-Agent": "ia-maps-app/1.0 (local)",
  }
  const username = process.env.OPEN_SKY_USERNAME
  const password = process.env.OPEN_SKY_PASSWORD
  if (username && password) {
    headers.Authorization =
      "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
  }

  try {
    const res = await fetch(url.toString(), { headers, cache: "no-store" })
    if (res.status === 429) {
      const payload = buildDemoPayload(lat, lon, flightRadius, true)
      cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload,
      })
      return payload
    }

    if (!res.ok) {
      const payload = buildDemoPayload(lat, lon, flightRadius, false)
      cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload,
      })
      return payload
    }

    const data = (await res.json()) as { time?: number; states?: unknown[] }
    const flights = normalizeFlights(data.states ?? [])
    const payload: AircraftResponse = {
      ok: true,
      mode: "live",
      source: "OpenSky",
      time: typeof data.time === "number" ? data.time : null,
      flights,
      refresh_ms: 10000,
    }
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    })
    return payload
  } catch {
    const payload = buildDemoPayload(lat, lon, flightRadius, false)
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    })
    return payload
  }
}

function normalizeFlights(states: unknown[]): AircraftState[] {
  if (!Array.isArray(states)) return []
  const flights: AircraftState[] = []

  for (const item of states) {
    if (!Array.isArray(item)) continue
    const lat = toNumber(item[6])
    const lon = toNumber(item[5])
    if (lat == null || lon == null) continue

    const id = typeof item[0] === "string" ? item[0] : "unknown"
    const callsign =
      typeof item[1] === "string" ? item[1].trim() || null : null
    const origin =
      typeof item[2] === "string" ? item[2].trim() || null : null
    const altitude =
      toNumber(item[7]) ?? (toNumber(item[13]) != null ? toNumber(item[13]) : null)
    const velocity = toNumber(item[9])
    const heading = toNumber(item[10])
    const onGround = Boolean(item[8])
    const lastContact = toNumber(item[4])
    const timePosition = toNumber(item[3])

    flights.push({
      id,
      callsign,
      origin_country: origin,
      lat,
      lon,
      altitude_m: altitude,
      velocity_mps: velocity,
      heading_deg: heading,
      on_ground: onGround,
      last_contact: lastContact,
      time_position: timePosition,
    })
  }

  return flights
}

function buildDemoPayload(
  lat: number,
  lon: number,
  radius_m: number,
  rateLimited: boolean
): AircraftResponse {
  const flights = buildDemoFlights(lat, lon)
  return {
    ok: true,
    mode: "demo",
    source: "Demo",
    time: Math.floor(Date.now() / 1000),
    flights,
    notice: rateLimited
      ? "OpenSky limitado por rate limit. Mostrando datos demo."
      : "OpenSky no disponible. Mostrando datos demo.",
    rate_limited: rateLimited,
    refresh_ms: rateLimited ? 30000 : 20000,
  }
}

function buildDemoFlights(lat: number, lon: number): AircraftState[] {
  const offsets = [
    { dx: 0.08, dy: 0.03, heading: 45 },
    { dx: -0.05, dy: 0.04, heading: 120 },
    { dx: 0.03, dy: -0.06, heading: 220 },
    { dx: -0.07, dy: -0.02, heading: 300 },
  ]

  return offsets.map((offset, index) => ({
    id: `demo-${index + 1}`,
    callsign: `DEMO${index + 1}`,
    origin_country: "Demo",
    lat: lat + offset.dy,
    lon: lon + offset.dx,
    altitude_m: 10000 + index * 800,
    velocity_mps: 220 + index * 10,
    heading_deg: offset.heading,
    on_ground: false,
    last_contact: Math.floor(Date.now() / 1000),
    time_position: Math.floor(Date.now() / 1000),
  }))
}

function toNumber(value: unknown): number | null {
  if (typeof value !== "number") return null
  return Number.isFinite(value) ? value : null
}

function buildBoundingBox(lat: number, lon: number, radius_m: number) {
  const deltaLat = radius_m / 111_320
  const deltaLon = radius_m / (111_320 * Math.cos((lat * Math.PI) / 180))

  return {
    minLat: clamp(lat - deltaLat, -90, 90),
    maxLat: clamp(lat + deltaLat, -90, 90),
    minLon: clamp(lon - deltaLon, -180, 180),
    maxLon: clamp(lon + deltaLon, -180, 180),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
