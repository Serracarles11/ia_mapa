import { NextResponse } from "next/server"

type PlaceResponse = {
  place: {
    name: string | null
    type: string | null
    category: string | null
    address: string | null
    display_name: string | null
  }
  pois: Array<{
    name: string | null
    category: string | null
    type: string | null
    lat: number | null
    lon: number | null
  }>
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    lat?: number
    lon?: number
  }

  if (typeof body.lat !== "number" || typeof body.lon !== "number") {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 })
  }

  const [nominatim, overpass] = await Promise.all([
    fetchNominatim(body.lat, body.lon),
    fetchOverpass(body.lat, body.lon),
  ])

  const place = normalizeNominatim(nominatim)
  const pois = normalizeOverpass(overpass)

  const payload: PlaceResponse = { place, pois }
  return NextResponse.json(payload)
}

async function fetchNominatim(lat: number, lon: number) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lon", String(lon))
  url.searchParams.set("accept-language", "es")

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "ia-maps-app" },
  })
  if (!res.ok) {
    return null
  }
  return res.json()
}

async function fetchOverpass(lat: number, lon: number) {
  const radius = 1500
  const query = `
[out:json][timeout:25];
(
  node["amenity"~"restaurant|bar|cafe|pub|fast_food"](around:${radius},${lat},${lon});
  node["amenity"~"hospital|clinic|doctors|pharmacy|school|university|bus_station|police|fire_station"](around:${radius},${lat},${lon});
  node["public_transport"](around:${radius},${lat},${lon});
  node["railway"="station"](around:${radius},${lat},${lon});
  node["amenity"="parking"](around:${radius},${lat},${lon});
  node["tourism"~"hotel|hostel|guest_house|attraction|museum|viewpoint"](around:${radius},${lat},${lon});
  way["amenity"~"restaurant|bar|cafe|pub|fast_food"](around:${radius},${lat},${lon});
  way["amenity"~"hospital|clinic|doctors|pharmacy|school|university|bus_station|police|fire_station"](around:${radius},${lat},${lon});
  way["public_transport"](around:${radius},${lat},${lon});
  way["railway"="station"](around:${radius},${lat},${lon});
  way["amenity"="parking"](around:${radius},${lat},${lon});
  way["tourism"~"hotel|hostel|guest_house|attraction|museum|viewpoint"](around:${radius},${lat},${lon});
  relation["amenity"~"restaurant|bar|cafe|pub|fast_food"](around:${radius},${lat},${lon});
  relation["amenity"~"hospital|clinic|doctors|pharmacy|school|university|bus_station|police|fire_station"](around:${radius},${lat},${lon});
  relation["public_transport"](around:${radius},${lat},${lon});
  relation["railway"="station"](around:${radius},${lat},${lon});
  relation["amenity"="parking"](around:${radius},${lat},${lon});
  relation["tourism"~"hotel|hostel|guest_house|attraction|museum|viewpoint"](around:${radius},${lat},${lon});
);
out center 50;
`

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": "ia-maps-app" },
    body: query,
  })

  if (!res.ok) {
    return null
  }
  return res.json()
}

function normalizeNominatim(data: unknown) {
  if (!isRecord(data)) {
    return {
      name: null,
      type: null,
      category: null,
      address: null,
      display_name: null,
    }
  }

  const address = isRecord(data.address) ? data.address : {}
  const street = [getString(address.house_number), getString(address.road)]
    .filter(Boolean)
    .join(" ")
  const locality = [getString(address.neighbourhood), getString(address.suburb)]
    .filter(Boolean)
    .join(", ")
  const city =
    getString(address.city) ||
    getString(address.town) ||
    getString(address.village) ||
    getString(address.hamlet) ||
    getString(address.county) ||
    null
  const addressLine = [
    street,
    locality,
    city,
    getString(address.state),
    getString(address.country),
  ]
    .filter(Boolean)
    .join(", ")

  return {
    name:
      getString(data.name) ||
      getString(address.attraction) ||
      getString(address.building) ||
      null,
    type: getString(data.type) || null,
    category: getString(data.category) || getString(data.class) || null,
    address: addressLine || null,
    display_name: getString(data.display_name) || null,
  }
}

function normalizeOverpass(data: unknown) {
  if (!isRecord(data) || !Array.isArray(data.elements)) return []

  return data.elements
    .map((element) => {
      if (!isRecord(element)) return null
      const tags = isRecord(element.tags) ? element.tags : {}
      const amenity = getString(tags.amenity)
      const tourism = getString(tags.tourism)
      const publicTransport = getString(tags.public_transport)
      const railway = getString(tags.railway)
      const category = amenity
      ? "amenity"
      : tourism
        ? "tourism"
        : publicTransport
          ? "public_transport"
          : railway
            ? "railway"
            : null

      const type = amenity || tourism || publicTransport || railway || null

      const lat =
        getNumber(element.lat) ??
        (isRecord(element.center) ? getNumber(element.center.lat) : null)
      const lon =
        getNumber(element.lon) ??
        (isRecord(element.center) ? getNumber(element.center.lon) : null)

      return {
        name: getString(tags.name) || null,
        category,
        type,
        lat,
        lon,
      }
    })
    .filter(
      (
        item
      ): item is {
        name: string | null
        category: string | null
        type: string | null
        lat: number | null
        lon: number | null
      } => Boolean(item)
    )
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
