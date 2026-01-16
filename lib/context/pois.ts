import { type ExternalPoi, type PoiItem, type PoisByCategory } from "@/lib/types"

export function createEmptyPois(): PoisByCategory {
  return {
    restaurants: [],
    bars_and_clubs: [],
    cafes: [],
    pharmacies: [],
    hospitals: [],
    schools: [],
    supermarkets: [],
    transport: [],
    hotels: [],
    tourism: [],
    museums: [],
    viewpoints: [],
  }
}

export function buildPoiSummary(pois: PoisByCategory) {
  const counts = {
    restaurants: pois.restaurants.length,
    bars_and_clubs: pois.bars_and_clubs.length,
    cafes: pois.cafes.length,
    pharmacies: pois.pharmacies.length,
    hospitals: pois.hospitals.length,
    schools: pois.schools.length,
    supermarkets: pois.supermarkets.length,
    transport: pois.transport.length,
    hotels: pois.hotels.length,
    tourism: pois.tourism.length,
    museums: pois.museums.length,
    viewpoints: pois.viewpoints.length,
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  return { counts, total }
}

export function sortPois(pois: PoisByCategory): PoisByCategory {
  const sort = (items: PoiItem[]) =>
    [...items].sort((a, b) => a.distance_m - b.distance_m)

  return {
    restaurants: sort(pois.restaurants),
    bars_and_clubs: sort(pois.bars_and_clubs),
    cafes: sort(pois.cafes),
    pharmacies: sort(pois.pharmacies),
    hospitals: sort(pois.hospitals),
    schools: sort(pois.schools),
    supermarkets: sort(pois.supermarkets),
    transport: sort(pois.transport),
    hotels: sort(pois.hotels),
    tourism: sort(pois.tourism),
    museums: sort(pois.museums),
    viewpoints: sort(pois.viewpoints),
  }
}

export function hasAnyPois(pois: PoisByCategory) {
  return (
    pois.restaurants.length > 0 ||
    pois.bars_and_clubs.length > 0 ||
    pois.cafes.length > 0 ||
    pois.pharmacies.length > 0 ||
    pois.hospitals.length > 0 ||
    pois.schools.length > 0 ||
    pois.supermarkets.length > 0 ||
    pois.transport.length > 0 ||
    pois.hotels.length > 0 ||
    pois.tourism.length > 0 ||
    pois.museums.length > 0 ||
    pois.viewpoints.length > 0
  )
}

export function mergePois(base: PoisByCategory, extra: PoisByCategory) {
  return sortPois({
    restaurants: [...base.restaurants, ...extra.restaurants],
    bars_and_clubs: [...base.bars_and_clubs, ...extra.bars_and_clubs],
    cafes: [...base.cafes, ...extra.cafes],
    pharmacies: [...base.pharmacies, ...extra.pharmacies],
    hospitals: [...base.hospitals, ...extra.hospitals],
    schools: [...base.schools, ...extra.schools],
    supermarkets: [...base.supermarkets, ...extra.supermarkets],
    transport: [...base.transport, ...extra.transport],
    hotels: [...base.hotels, ...extra.hotels],
    tourism: [...base.tourism, ...extra.tourism],
    museums: [...base.museums, ...extra.museums],
    viewpoints: [...base.viewpoints, ...extra.viewpoints],
  })
}

export function mapExternalPoisToCategories(
  externalPois: ExternalPoi[],
  center: { lat: number; lon: number }
) {
  const mapped = createEmptyPois()
  const extras: ExternalPoi[] = []

  for (const poi of externalPois) {
    const category = poi.category ?? ""
    const kinds = poi.kinds?.join(" ") ?? ""
    const key = [category, kinds].join(" ").toLowerCase()
    const coords = getCoords(poi)
    const distance =
      typeof poi.distance_m === "number"
        ? poi.distance_m
        : coords
          ? Math.round(distanceMeters(center.lat, center.lon, coords.lat, coords.lon))
          : null

    if (!coords || distance == null) {
      extras.push(poi)
      continue
    }

    const item: PoiItem = {
      name: poi.name,
      distance_m: distance,
      lat: coords.lat,
      lon: coords.lon,
      type: inferExternalType(key) ?? "poi",
      source: poi.source,
      category: poi.category,
      raw: poi.raw,
    }

    const bucket = pickBucket(key, item.type)
    if (!bucket) {
      extras.push(poi)
      continue
    }
    mapped[bucket].push(item)
  }

  return { mapped: sortPois(mapped), extras }
}

function pickBucket(
  key: string,
  type: string
): keyof PoisByCategory | null {
  if (type === "restaurant" || type === "fast_food") return "restaurants"
  if (type === "bar" || type === "club") return "bars_and_clubs"
  if (type === "cafe") return "cafes"
  if (type === "pharmacy") return "pharmacies"
  if (type === "hospital") return "hospitals"
  if (type === "school") return "schools"
  if (type === "supermarket") return "supermarkets"
  if (type === "bus_stop") return "transport"
  if (type === "hotel") return "hotels"
  if (type === "museum") return "museums"
  if (type === "viewpoint") return "viewpoints"
  if (type === "attraction" || key.includes("tourism")) return "tourism"
  return null
}

function inferExternalType(key: string) {
  if (key.includes("restaurant")) return "restaurant"
  if (key.includes("fast_food")) return "fast_food"
  if (key.includes("cafe")) return "cafe"
  if (key.includes("bar") || key.includes("pub")) return "bar"
  if (key.includes("nightclub") || key.includes("club")) return "club"
  if (key.includes("pharmacy")) return "pharmacy"
  if (key.includes("hospital") || key.includes("clinic")) return "hospital"
  if (key.includes("school") || key.includes("college") || key.includes("university")) {
    return "school"
  }
  if (key.includes("supermarket")) return "supermarket"
  if (key.includes("bus") || key.includes("station") || key.includes("transport")) {
    return "bus_stop"
  }
  if (key.includes("hotel") || key.includes("hostel") || key.includes("guest_house")) {
    return "hotel"
  }
  if (key.includes("museum")) return "museum"
  if (key.includes("viewpoint")) return "viewpoint"
  if (key.includes("attraction") || key.includes("tourism") || key.includes("monument")) {
    return "attraction"
  }
  return null
}

function getCoords(poi: ExternalPoi) {
  if (typeof poi.lat !== "number" || typeof poi.lon !== "number") return null
  return { lat: poi.lat, lon: poi.lon }
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
