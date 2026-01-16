import "server-only"

import { type WikipediaNearbyItem } from "@/lib/types"

const DEFAULT_ENDPOINT = "https://es.wikipedia.org/w/api.php"
const USER_AGENT =
  process.env.WIKIPEDIA_USER_AGENT ||
  process.env.WIKIDATA_USER_AGENT ||
  "ia-maps-app/1.0 (local)"

const CACHE_TTL_MS = 1000 * 60 * 15
const cache = new Map<
  string,
  { expiresAt: number; value: WikipediaNearbyItem[] }
>()

type GeoSearchItem = {
  pageid: number
  title: string
  lat: number
  lon: number
  dist?: number
}

type WikipediaPage = {
  pageid?: number
  title?: string
  extract?: string
  description?: string
  fullurl?: string
  thumbnail?: { source?: string }
}

export async function fetchWikipediaNearby(
  lat: number,
  lon: number,
  radius_m: number,
  limit = 6
): Promise<WikipediaNearbyItem[]> {
  const safeLimit = clamp(limit, 1, 12)
  const safeRadius = clamp(Math.round(radius_m), 300, 10000)
  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${safeRadius}:${safeLimit}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const geoItems = await fetchGeoSearch(lat, lon, safeRadius, safeLimit)
  if (geoItems.length === 0) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: [],
    })
    return []
  }

  const pageMap = await fetchPageDetails(
    geoItems.map((item) => item.pageid)
  )

  const results = geoItems
    .map((item): WikipediaNearbyItem | null => {
      const page = pageMap.get(item.pageid)
      const title = page?.title || item.title
      if (!title) return null
      const distance =
        typeof item.dist === "number"
          ? Math.round(item.dist)
          : Number.isFinite(item.lat) && Number.isFinite(item.lon)
            ? Math.round(distanceMeters(lat, lon, item.lat, item.lon))
            : null
      return {
        pageid: item.pageid,
        title,
        extract: page?.extract ?? null,
        description: page?.description ?? null,
        url: page?.fullurl ?? null,
        distance_m: distance,
        coordinates: { lat: item.lat, lon: item.lon },
        thumbnail: page?.thumbnail?.source ?? null,
      }
    })
    .filter((item): item is WikipediaNearbyItem => Boolean(item))

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: results,
  })

  return results
}

async function fetchGeoSearch(
  lat: number,
  lon: number,
  radius: number,
  limit: number
): Promise<GeoSearchItem[]> {
  const url = new URL(process.env.WIKIPEDIA_API_URL || DEFAULT_ENDPOINT)
  url.searchParams.set("action", "query")
  url.searchParams.set("format", "json")
  url.searchParams.set("list", "geosearch")
  url.searchParams.set("gscoord", `${lat}|${lon}`)
  url.searchParams.set("gsradius", String(radius))
  url.searchParams.set("gslimit", String(limit))
  url.searchParams.set("gsprop", "type|name|country|region|globe")
  url.searchParams.set("origin", "*")

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  })

  if (!res.ok) return []
  const data = (await res.json()) as {
    query?: { geosearch?: Array<Record<string, unknown>> }
  }

  const list = Array.isArray(data.query?.geosearch)
    ? data.query?.geosearch ?? []
    : []

  return list
    .map((item): GeoSearchItem | null => {
      const pageid = toNumber(item.pageid)
      const title = typeof item.title === "string" ? item.title : ""
      const latValue = toNumber(item.lat)
      const lonValue = toNumber(item.lon)
      if (!pageid || !title || latValue == null || lonValue == null) return null
      return {
        pageid,
        title,
        lat: latValue,
        lon: lonValue,
        dist: toNumber(item.dist) ?? undefined,
      }
    })
    .filter((item): item is GeoSearchItem => Boolean(item))
}

async function fetchPageDetails(pageIds: number[]) {
  if (pageIds.length === 0) return new Map<number, WikipediaPage>()

  const url = new URL(process.env.WIKIPEDIA_API_URL || DEFAULT_ENDPOINT)
  url.searchParams.set("action", "query")
  url.searchParams.set("format", "json")
  url.searchParams.set("prop", "extracts|pageimages|description|info")
  url.searchParams.set("inprop", "url")
  url.searchParams.set("pageids", pageIds.join("|"))
  url.searchParams.set("exintro", "1")
  url.searchParams.set("explaintext", "1")
  url.searchParams.set("pithumbsize", "240")
  url.searchParams.set("origin", "*")

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  })

  if (!res.ok) return new Map<number, WikipediaPage>()
  const data = (await res.json()) as {
    query?: { pages?: Record<string, WikipediaPage> }
  }

  const pages = data.query?.pages ?? {}
  const map = new Map<number, WikipediaPage>()
  for (const page of Object.values(pages)) {
    if (typeof page.pageid !== "number") continue
    map.set(page.pageid, page)
  }
  return map
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}
