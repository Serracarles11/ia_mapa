import "server-only"

export type NominatimPlace = {
  name: string | null
  type: string | null
  category: string | null
  addressLine: string | null
  municipality: string | null
  island: string | null
  region: string | null
  country: string | null
}

export async function fetchNominatim(lat: number, lon: number) {
  const baseUrl =
    process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/reverse"
  const url = new URL(baseUrl)
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lon", String(lon))
  url.searchParams.set("accept-language", "es")

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "ia-maps-app" },
  })

  if (!res.ok) return null
  return res.json()
}

export function normalizeNominatim(data: unknown): NominatimPlace {
  if (!isRecord(data)) {
    return {
      name: null,
      type: null,
      category: null,
      addressLine: null,
      municipality: null,
      island: null,
      region: null,
      country: null,
    }
  }

  const address = isRecord(data.address) ? data.address : {}
  const street = [getString(address.house_number), getString(address.road)]
    .filter(Boolean)
    .join(" ")
  const locality = [getString(address.neighbourhood), getString(address.suburb)]
    .filter(Boolean)
    .join(", ")

  const municipality =
    getString(address.city) ||
    getString(address.town) ||
    getString(address.village) ||
    getString(address.hamlet) ||
    getString(address.county) ||
    null

  const addressLine = [
    street,
    locality,
    municipality,
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
    addressLine: addressLine || null,
    municipality,
    island: getString(address.island) || null,
    region: getString(address.state) || null,
    country: getString(address.country) || null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
