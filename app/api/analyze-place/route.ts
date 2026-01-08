import { NextResponse } from "next/server"
import { fetchNominatim, normalizeNominatim } from "@/lib/nominatim"
import { fetchOverpassPois, type OverpassPoi } from "@/lib/overpass"
import { generateAiReportSafe, type AiReport } from "@/lib/groq"
import { saveAiReport } from "@/lib/reports"

type AnalyzeRequest = {
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number }
  radius_m?: number
  request_id?: number
}

type PoiDistance = {
  name: string
  distance_m: number
  lat?: number
  lon?: number
}

type RestaurantItem = PoiDistance & {
  cuisine: string | null
  rating: number | null
  price_range: string | null
}

type ContextData = {
  center: { lat: number; lon: number }
  radius_m: number
  is_touristic_area: boolean
  pois: {
    restaurants: Array<
      PoiDistance & {
        type: "restaurant" | "fast_food"
        cuisine?: string | null
        rating?: number | null
        price_range?: string | null
      }
    >
    bars_and_clubs: Array<PoiDistance & { type: "bar" | "club" }>
    cafes: Array<PoiDistance & { type: "cafe" }>
    pharmacies: Array<PoiDistance & { type: "pharmacy" }>
    hospitals: Array<PoiDistance & { type: "hospital" }>
    schools: Array<PoiDistance & { type: "school" }>
    supermarkets: Array<PoiDistance & { type: "supermarket" }>
    transport: Array<PoiDistance & { type: "bus_stop" }>
    hotels: Array<PoiDistance & { type: "hotel" }>
    tourism: Array<PoiDistance & { type: "attraction" }>
    museums: Array<PoiDistance & { type: "museum" }>
    viewpoints: Array<PoiDistance & { type: "viewpoint" }>
  }
}

type AnalyzeStatus = "OK" | "NO_POIS" | "OVERPASS_DOWN"

type AnalyzePlacePayload = {
  ok: true
  request_id: number | null
  placeName: string | null
  contextData: ContextData | null
  overpass_ok: boolean
  overpass_error: string | null
  status: AnalyzeStatus
  aiReport: AiReport | null
  fallbackReport: AiReport | null
  warning?: string | null
  warnings: string[]
}

const cache = new Map<string, { expiresAt: number; payload: AnalyzePlacePayload }>()
const CACHE_TTL_MS = 1000 * 60 * 10
const RADIUS_M = 1200
let lastValidContext: ContextData | null = null
let lastValidReport: AiReport | null = null
let lastValidPlaceName: string | null = null

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as AnalyzeRequest

  const centerLat = body.center?.lat ?? body.lat
  const centerLon = body.center?.lon ?? body.lon
  const radiusM =
    typeof body.radius_m === "number" && body.radius_m > 0
      ? body.radius_m
      : RADIUS_M
  const requestId =
    typeof body.request_id === "number" ? body.request_id : null

  if (typeof centerLat !== "number" || typeof centerLon !== "number") {
    return NextResponse.json({ ok: false, error: "Missing lat/lon" })
  }

  if (process.env.NODE_ENV === "development") {
    console.info("Analyze place request", {
      lat: centerLat,
      lon: centerLon,
      radius_m: radiusM,
      request_id: requestId,
    })
  }

  const cacheKey = `${centerLat.toFixed(6)}:${centerLon.toFixed(6)}:${Math.round(
    radiusM
  )}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      ...cached.payload,
      request_id: requestId,
    })
  }

  try {
    let nominatimRaw: unknown = null
    let overpassPois: OverpassPoi[] | null = null
    let overpassOk = false
    let overpassError: string | null = null

    try {
      nominatimRaw = await fetchNominatim(centerLat, centerLon)
    } catch (error) {
      console.error("Nominatim failed", error)
    }

    try {
      overpassPois = await fetchOverpassPois(centerLat, centerLon, radiusM)
      overpassOk = Boolean(overpassPois)
      if (!overpassOk) {
        overpassError = "Overpass no disponible"
      }
    } catch (error) {
      console.error("Overpass failed", error)
      overpassOk = false
      overpassError = "Overpass no disponible"
    }

    if (process.env.NODE_ENV === "development") {
      console.info(overpassOk ? "Overpass OK" : "Overpass FAIL", {
        error: overpassError,
      })
    }

    const nominatim = normalizeNominatim(nominatimRaw)
    const placeName =
      nominatim.name || nominatim.addressLine || nominatim.municipality || null

    if (!overpassOk) {
      const warning = overpassError || "Overpass no disponible"
      const warnings = [warning]
      const payload = {
        ok: true,
        request_id: requestId,
        placeName: lastValidContext ? lastValidPlaceName : placeName,
        contextData: lastValidContext ?? null,
        overpass_ok: false,
        overpass_error: overpassError,
        status: "OVERPASS_DOWN" as const,
        aiReport: null,
        fallbackReport: lastValidReport ?? null,
        warning,
        warnings,
      }

      return NextResponse.json(payload)
    }

    const pois = overpassPois ?? []
    const contextData = buildContext(centerLat, centerLon, radiusM, pois)

    if (process.env.NODE_ENV === "development") {
      console.info("AI context payload", JSON.stringify(contextData))
    }

    let status: AnalyzeStatus = "OK"
    let aiReport: AiReport | null = null
    let fallbackReport: AiReport | null = null
    const warnings: string[] = []

    if (!hasAnyPois(contextData)) {
      status = "NO_POIS"
      warnings.push(`No se encontraron POIs en el radio ${Math.round(radiusM)} m`)
      fallbackReport = buildNoPoisReport(
        contextData,
        warnings[warnings.length - 1]
      )
    } else {
      try {
        const aiResult = await generateAiReportSafe(contextData)
        if (aiResult.warning) {
          warnings.push(aiResult.warning)
          fallbackReport = sanitizeReport(aiResult.report, contextData)
          aiReport = null
        } else {
          aiReport = sanitizeReport(aiResult.report, contextData)
        }
        if (process.env.NODE_ENV === "development") {
          console.info(aiResult.warning ? "Groq FAIL" : "Groq OK")
        }
      } catch (error) {
        console.error("Groq failed", error)
        warnings.push("Groq no disponible")
      }

      if (!aiReport || !aiReport.summary_general) {
        fallbackReport = buildFallbackReport(
          contextData,
          warnings[warnings.length - 1] || "Groq no disponible"
        )
        aiReport = null
      }
    }

    if (aiReport || fallbackReport) {
      try {
        await saveAiReport({
          place_name: placeName,
          lat: centerLat,
          lon: centerLon,
          category: nominatim.category || nominatim.type || null,
          report: aiReport ?? fallbackReport,
        })
      } catch (error) {
        console.error("Failed to save ai report", error)
      }
    }

    const payload = {
      ok: true,
      request_id: requestId,
      placeName,
      contextData,
      overpass_ok: overpassOk,
      overpass_error: overpassError,
      status,
      aiReport,
      fallbackReport,
      warning: warnings.length > 0 ? warnings[0] : null,
      warnings,
    }

    if (status !== "OVERPASS_DOWN") {
      cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload,
      })
    }

    lastValidContext = contextData
    lastValidPlaceName = placeName
    if (aiReport || fallbackReport) {
      lastValidReport = aiReport ?? fallbackReport
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("Analyze place failed", error)
    return NextResponse.json({
      ok: false,
      request_id: requestId,
      error: "Failed to analyze place",
    })
  }
}

function buildContext(
  lat: number,
  lon: number,
  radiusM: number,
  pois: OverpassPoi[]
): ContextData {
  const withDistance = pois
    .map((poi) => {
      if (poi.lat == null || poi.lon == null) return null
      return {
        ...poi,
        distance_m: Math.round(distanceMeters(lat, lon, poi.lat, poi.lon)),
      }
    })
    .filter((poi): poi is OverpassPoi & { distance_m: number } => Boolean(poi))
    .filter((poi) => poi.distance_m <= radiusM)

  const hasName = (
    poi: OverpassPoi & { distance_m: number }
  ): poi is OverpassPoi & { distance_m: number; name: string } =>
    typeof poi.name === "string" && poi.name.trim().length > 0

  const list = (types: string[]) =>
    withDistance
      .filter((poi) => types.includes(poi.type || ""))
      .filter(hasName)
      .sort((a, b) => a.distance_m - b.distance_m)
      .map((poi) => ({
        name: poi.name,
        distance_m: poi.distance_m,
        lat: poi.lat ?? undefined,
        lon: poi.lon ?? undefined,
      }))

  const restaurants = withDistance
    .filter(
      (poi) =>
        poi.type === "restaurant" || poi.type === "fast_food"
    )
    .filter(hasName)
    .sort((a, b) => a.distance_m - b.distance_m)
    .map((poi) => ({
      name: poi.name,
      distance_m: poi.distance_m,
      lat: poi.lat ?? undefined,
      lon: poi.lon ?? undefined,
      type: (poi.type === "fast_food" ? "fast_food" : "restaurant") as const,
      cuisine: poi.cuisine ?? null,
      price_range: poi.price_range ?? null,
    }))

  const bars = withDistance
    .filter((poi) => poi.type === "bar" || poi.type === "nightclub")
    .filter(hasName)
    .sort((a, b) => a.distance_m - b.distance_m)
    .map((poi) => ({
      name: poi.name,
      distance_m: poi.distance_m,
      lat: poi.lat ?? undefined,
      lon: poi.lon ?? undefined,
      type: (poi.type === "nightclub" ? "club" : "bar") as const,
    }))

  return {
    center: { lat, lon },
    radius_m: radiusM,
    is_touristic_area: isTouristicArea(withDistance),
    pois: {
      restaurants,
      bars_and_clubs: bars,
      cafes: list(["cafe"]).map((poi) => ({ ...poi, type: "cafe" as const })),
      pharmacies: list(["pharmacy"]).map((poi) => ({
        ...poi,
        type: "pharmacy" as const,
      })),
      hospitals: list(["hospital"]).map((poi) => ({
        ...poi,
        type: "hospital" as const,
      })),
      schools: list(["school"]).map((poi) => ({
        ...poi,
        type: "school" as const,
      })),
      supermarkets: list(["supermarket"]).map((poi) => ({
        ...poi,
        type: "supermarket" as const,
      })),
      transport: list(["bus_stop", "bus_station"]).map((poi) => ({
        ...poi,
        type: "bus_stop" as const,
      })),
      hotels: list(["hotel"]).map((poi) => ({ ...poi, type: "hotel" as const })),
      tourism: list(["attraction"]).map((poi) => ({
        ...poi,
        type: "attraction" as const,
      })),
      museums: list(["museum"]).map((poi) => ({
        ...poi,
        type: "museum" as const,
      })),
      viewpoints: list(["viewpoint"]).map((poi) => ({
        ...poi,
        type: "viewpoint" as const,
      })),
    },
  }
}

function hasAnyPois(context: ContextData) {
  const pois = context.pois
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

function isTouristicArea(pois: Array<OverpassPoi & { distance_m: number }>) {
  return pois.some((poi) => poi.type === "hotel" || poi.type === "attraction")
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

function buildNoPoisReport(context: ContextData, reason: string): AiReport {
  return {
    place_name: null,
    summary_general: `No se encontraron POIs en el radio ${Math.round(
      context.radius_m
    )} m.`,
    restaurants_nearby: [],
    ocio_inmediato: [],
    services: {
      pharmacies: [],
      hospitals: [],
      schools: [],
      bus_stops: [],
      supermarkets: [],
    },
    tourism: {
      hotels: [],
      museums: [],
      attractions: [],
      viewpoints: [],
    },
    limited_info: {
      is_limited: true,
      reason,
    },
  }
}

function buildFallbackReport(context: ContextData, reason: string): AiReport {
  const hasPois = hasAnyPois(context)
  const summaryParts = [
    `Restaurantes: ${context.pois.restaurants.length}`,
    `Bares/clubes: ${context.pois.bars_and_clubs.length}`,
    `Cafes: ${context.pois.cafes.length}`,
    `Supermercados: ${context.pois.supermarkets.length}`,
    `Paradas de bus: ${context.pois.transport.length}`,
    `Hoteles: ${context.pois.hotels.length}`,
    `Atracciones: ${context.pois.tourism.length}`,
  ]

  return {
    place_name: null,
    summary_general: `Resumen basado en datos OSM. ${summaryParts.join(". ")}.`,
    restaurants_nearby: context.pois.restaurants
      .slice(0, 10)
      .map(toRestaurantItem),
    ocio_inmediato: buildOcio(context)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 20),
    services: {
      pharmacies: context.pois.pharmacies.map(toPoiItem),
      hospitals: context.pois.hospitals.map(toPoiItem),
      schools: context.pois.schools.map(toPoiItem),
      bus_stops: context.pois.transport.map(toPoiItem),
      supermarkets: context.pois.supermarkets.map(toPoiItem),
    },
    tourism: {
      hotels: context.pois.hotels.map(toPoiItem),
      museums: context.pois.museums.map(toPoiItem),
      attractions: context.pois.tourism.map(toPoiItem),
      viewpoints: context.pois.viewpoints.map(toPoiItem),
    },
    limited_info: {
      is_limited: !hasPois,
      reason: hasPois ? null : reason,
    },
  }
}

function toPoiItem(poi: PoiDistance) {
  return { name: poi.name, distance_m: poi.distance_m }
}

function toRestaurantItem(
  poi: ContextData["pois"]["restaurants"][number]
): RestaurantItem {
  return {
    name: poi.name,
    distance_m: poi.distance_m,
    cuisine: poi.cuisine ?? null,
    rating: poi.rating ?? null,
    price_range: poi.price_range ?? null,
  }
}

function buildOcio(context: ContextData) {
  return [
    ...context.pois.bars_and_clubs.map((poi) => ({
      name: poi.name,
      distance_m: poi.distance_m,
      type: (poi.type === "club" ? "club" : "bar") as const,
    })),
    ...context.pois.cafes.map((poi) => ({
      name: poi.name,
      distance_m: poi.distance_m,
      type: "cafe" as const,
    })),
    ...context.pois.restaurants
      .filter((poi) => poi.type === "fast_food")
      .map((poi) => ({
        name: poi.name,
        distance_m: poi.distance_m,
        type: "fast_food" as const,
      })),
  ]
}

function sanitizeReport(report: AiReport, context: ContextData): AiReport {
  const nameIndex = buildNameIndex(context)
  const radiusM = context.radius_m

  const restaurants = sanitizeRestaurants(
    report.restaurants_nearby,
    nameIndex.restaurants,
    radiusM,
    10
  )

  const ocio = sanitizeOcio(report.ocio_inmediato, nameIndex, radiusM)

  const services = {
    pharmacies: sanitizeList(
      report.services.pharmacies,
      nameIndex.pharmacies,
      radiusM
    ),
    hospitals: sanitizeList(
      report.services.hospitals,
      nameIndex.hospitals,
      radiusM
    ),
    schools: sanitizeList(
      report.services.schools,
      nameIndex.schools,
      radiusM
    ),
    bus_stops: sanitizeList(
      report.services.bus_stops,
      nameIndex.bus_stops,
      radiusM
    ),
    supermarkets: sanitizeList(
      report.services.supermarkets,
      nameIndex.supermarkets,
      radiusM
    ),
  }

  const tourism = {
    hotels: sanitizeList(report.tourism.hotels, nameIndex.hotels, radiusM),
    museums: sanitizeList(report.tourism.museums, nameIndex.museums, radiusM),
    attractions: sanitizeList(
      report.tourism.attractions,
      nameIndex.attractions,
      radiusM
    ),
    viewpoints: sanitizeList(
      report.tourism.viewpoints,
      nameIndex.viewpoints,
      radiusM
    ),
  }

  const sanitized: AiReport = {
    ...report,
    restaurants_nearby: restaurants,
    ocio_inmediato: ocio,
    services,
    tourism,
    limited_info: {
      is_limited: false,
      reason: null,
    },
  }

  const isLimited = computeIsLimited(sanitized)
  return {
    ...sanitized,
    limited_info: {
      is_limited: isLimited,
      reason:
        isLimited && typeof report.limited_info?.reason === "string"
          ? report.limited_info.reason
          : isLimited
            ? "Datos insuficientes"
            : null,
    },
  }
}

function sanitizeList(
  items: Array<{ name?: string; distance_m?: number }>,
  allowed: Map<string, number>,
  radiusM: number,
  limit?: number
) {
  const normalized = items
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : null
      if (!name) return null
      const distance =
        typeof item.distance_m === "number" ? item.distance_m : allowed.get(name)
      if (typeof distance !== "number") return null
      if (distance > radiusM) return null
      if (!allowed.has(name)) return null
      return { name, distance_m: distance }
    })
    .filter((item): item is { name: string; distance_m: number } => Boolean(item))
    .sort((a, b) => a.distance_m - b.distance_m)

  return typeof limit === "number" ? normalized.slice(0, limit) : normalized
}

function sanitizeRestaurants(
  items: Array<{
    name?: string
    distance_m?: number
    cuisine?: string | null
    rating?: number | null
    price_range?: string | null
  }>,
  allowed: Map<
    string,
    { distance_m: number; cuisine: string | null; rating: number | null; price_range: string | null }
  >,
  radiusM: number,
  limit?: number
) {
  const normalized = items
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : null
      if (!name) return null
      const meta = allowed.get(name)
      if (!meta) return null
      const distance =
        typeof item.distance_m === "number" ? item.distance_m : meta.distance_m
      if (typeof distance !== "number") return null
      if (distance > radiusM) return null
      return {
        name,
        distance_m: distance,
        cuisine: meta.cuisine,
        rating: meta.rating,
        price_range: meta.price_range,
      }
    })
    .filter(
      (
        item
      ): item is RestaurantItem =>
        Boolean(item)
    )
    .sort((a, b) => a.distance_m - b.distance_m)

  return typeof limit === "number" ? normalized.slice(0, limit) : normalized
}

function sanitizeOcio(
  items: Array<{ name?: string; distance_m?: number; type?: string }>,
  allowed: ReturnType<typeof buildNameIndex>,
  radiusM: number
) {
  return items
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : null
      const type = item.type
      if (!name || typeof type !== "string") return null
      const allowedSet =
        type === "bar"
          ? allowed.bars
          : type === "cafe"
            ? allowed.cafes
            : type === "club"
              ? allowed.clubs
              : type === "fast_food"
                ? allowed.fast_food
                : null
      if (!allowedSet) return null
      const distance =
        typeof item.distance_m === "number" ? item.distance_m : allowedSet.get(name)
      if (typeof distance !== "number") return null
      if (distance > radiusM) return null
      if (!allowedSet.has(name)) return null
      return {
        name,
        distance_m: distance,
        type: type as "bar" | "cafe" | "club" | "fast_food",
      }
    })
    .filter(
      (
        item
      ): item is {
        name: string
        distance_m: number
        type: "bar" | "cafe" | "club" | "fast_food"
      } =>
        Boolean(item)
    )
    .sort((a, b) => a.distance_m - b.distance_m)
}

function buildNameIndex(context: ContextData) {
  const toMap = (items: PoiDistance[]) =>
    new Map(items.map((item) => [item.name, item.distance_m]))

  return {
    restaurants: new Map(
      context.pois.restaurants.map((item) => [
        item.name,
        {
          distance_m: item.distance_m,
          cuisine: item.cuisine ?? null,
          rating: item.rating ?? null,
          price_range: item.price_range ?? null,
        },
      ])
    ),
    fast_food: toMap(
      context.pois.restaurants.filter((item) => item.type === "fast_food")
    ),
    bars: toMap(
      context.pois.bars_and_clubs.filter((item) => item.type === "bar")
    ),
    clubs: toMap(
      context.pois.bars_and_clubs.filter((item) => item.type === "club")
    ),
    cafes: toMap(context.pois.cafes),
    pharmacies: toMap(context.pois.pharmacies),
    hospitals: toMap(context.pois.hospitals),
    schools: toMap(context.pois.schools),
    bus_stops: toMap(context.pois.transport),
    supermarkets: toMap(context.pois.supermarkets),
    hotels: toMap(context.pois.hotels),
    museums: toMap(context.pois.museums),
    attractions: toMap(context.pois.tourism),
    viewpoints: toMap(context.pois.viewpoints),
  }
}

function computeIsLimited(report: AiReport) {
  return (
    report.restaurants_nearby.length === 0 &&
    report.ocio_inmediato.length === 0 &&
    report.services.pharmacies.length === 0 &&
    report.services.hospitals.length === 0 &&
    report.services.schools.length === 0 &&
    report.services.bus_stops.length === 0 &&
    report.services.supermarkets.length === 0 &&
    report.tourism.hotels.length === 0 &&
    report.tourism.museums.length === 0 &&
    report.tourism.attractions.length === 0 &&
    report.tourism.viewpoints.length === 0
  )
}
