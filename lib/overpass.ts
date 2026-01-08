import "server-only"

export type OverpassPoi = {
  name: string | null
  category: string | null
  type: string | null
  lat: number | null
  lon: number | null
  cuisine?: string | null
  price_range?: string | null
}

type OverpassElement = {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const DEFAULT_RADIUS_METERS = 1200
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter"

export async function fetchOverpassPois(
  lat: number,
  lon: number,
  radiusMeters = DEFAULT_RADIUS_METERS
) {
  const query = buildOverpassQuery(lat, lon, radiusMeters)
  const overpassUrl = process.env.OVERPASS_URL || DEFAULT_OVERPASS_URL
  const res = await fetch(overpassUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": "ia-maps-app" },
    body: query,
  })

  if (!res.ok) return null
  const data = (await res.json()) as { elements?: OverpassElement[] }
  return normalizeOverpass(data?.elements || [])
}

function buildOverpassQuery(lat: number, lon: number, radiusMeters: number) {
  return `
[out:json][timeout:25];
(
  node["amenity"="restaurant"](around:${radiusMeters},${lat},${lon});
  node["amenity"="bar"](around:${radiusMeters},${lat},${lon});
  node["amenity"="nightclub"](around:${radiusMeters},${lat},${lon});
  node["amenity"="cafe"](around:${radiusMeters},${lat},${lon});
  node["amenity"="fast_food"](around:${radiusMeters},${lat},${lon});
  node["amenity"="pharmacy"](around:${radiusMeters},${lat},${lon});
  node["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
  node["amenity"="school"](around:${radiusMeters},${lat},${lon});
  node["shop"="supermarket"](around:${radiusMeters},${lat},${lon});
  node["tourism"="hotel"](around:${radiusMeters},${lat},${lon});
  node["tourism"="attraction"](around:${radiusMeters},${lat},${lon});
  node["tourism"="museum"](around:${radiusMeters},${lat},${lon});
  node["tourism"="viewpoint"](around:${radiusMeters},${lat},${lon});
  node["highway"="bus_stop"](around:${radiusMeters},${lat},${lon});
  node["amenity"="bus_station"](around:${radiusMeters},${lat},${lon});

  way["amenity"="restaurant"](around:${radiusMeters},${lat},${lon});
  way["amenity"="bar"](around:${radiusMeters},${lat},${lon});
  way["amenity"="nightclub"](around:${radiusMeters},${lat},${lon});
  way["amenity"="cafe"](around:${radiusMeters},${lat},${lon});
  way["amenity"="fast_food"](around:${radiusMeters},${lat},${lon});
  way["amenity"="pharmacy"](around:${radiusMeters},${lat},${lon});
  way["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
  way["amenity"="school"](around:${radiusMeters},${lat},${lon});
  way["shop"="supermarket"](around:${radiusMeters},${lat},${lon});
  way["tourism"="hotel"](around:${radiusMeters},${lat},${lon});
  way["tourism"="attraction"](around:${radiusMeters},${lat},${lon});
  way["tourism"="museum"](around:${radiusMeters},${lat},${lon});
  way["tourism"="viewpoint"](around:${radiusMeters},${lat},${lon});
  way["highway"="bus_stop"](around:${radiusMeters},${lat},${lon});
  way["amenity"="bus_station"](around:${radiusMeters},${lat},${lon});

  relation["amenity"="restaurant"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="bar"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="nightclub"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="cafe"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="fast_food"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="pharmacy"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="hospital"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="school"](around:${radiusMeters},${lat},${lon});
  relation["shop"="supermarket"](around:${radiusMeters},${lat},${lon});
  relation["tourism"="hotel"](around:${radiusMeters},${lat},${lon});
  relation["tourism"="attraction"](around:${radiusMeters},${lat},${lon});
  relation["tourism"="museum"](around:${radiusMeters},${lat},${lon});
  relation["tourism"="viewpoint"](around:${radiusMeters},${lat},${lon});
  relation["highway"="bus_stop"](around:${radiusMeters},${lat},${lon});
  relation["amenity"="bus_station"](around:${radiusMeters},${lat},${lon});
);
out center 80;
`
}

function normalizeOverpass(elements: OverpassElement[]): OverpassPoi[] {
  return elements.map((element) => {
    const tags = element.tags || {}
    const category = tags.amenity
      ? "amenity"
      : tags.tourism
        ? "tourism"
        : tags.highway
          ? "highway"
          : tags.public_transport
            ? "public_transport"
            : tags.shop
              ? "shop"
              : null

    const type =
      tags.amenity ||
      tags.tourism ||
      tags.highway ||
      tags.public_transport ||
      tags.shop ||
      null

    const lat = element.lat ?? element.center?.lat ?? null
    const lon = element.lon ?? element.center?.lon ?? null

    return {
      name: tags.name || null,
      category,
      type,
      lat,
      lon,
      cuisine: tags.cuisine || null,
      price_range:
        tags["price"] || tags["price_range"] || tags["price:range"] || null,
    }
  })
}
