import "server-only"

import { type ExternalPoi } from "@/lib/types"

const DEFAULT_ENDPOINT = "https://api.geoapify.com/v2/places"

export async function fetchGeoapifyPlaces(
  lat: number,
  lon: number,
  radius_m: number,
  limit = 60
): Promise<ExternalPoi[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY
  if (!apiKey) return []

  const url = new URL(process.env.GEOAPIFY_API_URL || DEFAULT_ENDPOINT)
  url.searchParams.set("categories", buildCategoriesParam())
  url.searchParams.set("filter", `circle:${lon},${lat},${Math.round(radius_m)}`)
  url.searchParams.set("bias", `proximity:${lon},${lat}`)
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 10), 100)))
  url.searchParams.set("apiKey", apiKey)

  const res = await fetch(url.toString(), { cache: "no-store" })
  if (!res.ok) return []

  const data = (await res.json()) as {
    features?: Array<{
      properties?: Record<string, unknown>
      geometry?: { coordinates?: [number, number] }
    }>
  }

  const features = Array.isArray(data.features) ? data.features : []

  return features
    .map((feature) => normalizeFeature(feature))
    .filter((item): item is ExternalPoi => Boolean(item))
}

function normalizeFeature(feature: {
  properties?: Record<string, unknown>
  geometry?: { coordinates?: [number, number] }
}) {
  const props = feature.properties ?? {}
  const name =
    typeof props.name === "string"
      ? props.name
      : typeof props.address_line1 === "string"
        ? props.address_line1
        : null

  if (!name) return null

  const categories = Array.isArray(props.categories)
    ? props.categories.filter((item) => typeof item === "string")
    : []

  const distance =
    typeof props.distance === "number" ? Math.round(props.distance) : null

  const coords = feature.geometry?.coordinates
  const lon = Array.isArray(coords) ? coords[0] : null
  const lat = Array.isArray(coords) ? coords[1] : null

  return {
    name,
    source: "Geoapify" as const,
    category: categories.length > 0 ? categories[0] : null,
    distance_m: distance,
    lat: typeof lat === "number" ? lat : null,
    lon: typeof lon === "number" ? lon : null,
    kinds: categories,
    url: typeof props.website === "string" ? props.website : null,
    raw: props,
  }
}

function buildCategoriesParam() {
  return [
    "catering.restaurant",
    "catering.fast_food",
    "catering.cafe",
    "catering.bar",
    "catering.pub",
    "entertainment.nightclub",
    "commercial.supermarket",
    "service.pharmacy",
    "healthcare.hospital",
    "education.school",
    "public_transport",
    "accommodation.hotel",
    "tourism.attraction",
    "tourism.museum",
    "tourism.viewpoint",
  ].join(",")
}
