import "server-only"

import { reverseGeocode } from "@/lib/osm/nominatim"
import {
  fetchLanduseSummary,
  fetchNearestWaterways,
  fetchOverpassPois,
  type OverpassPoi,
} from "@/lib/osm/overpass"
import { fetchOpenMeteoWeather } from "@/lib/environment/openMeteo"
import { capasUrbanismo } from "@/lib/tools/capasUrbanismo"
import { aireContaminacion } from "@/lib/tools/aireContaminacion"
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion"
import { fetchGeoapifyPlaces } from "@/lib/places/geoapify"
import { fetchWikidataInfo, fetchWikidataNearby } from "@/lib/wikidata"
import { fetchWikipediaNearby } from "@/lib/wikipedia"
import {
  buildPoiSummary,
  createEmptyPois,
  mapExternalPoisToCategories,
  mergePois,
  sortPois,
} from "@/lib/context/pois"
import {
  type AdminInfo,
  type ContextData,
  type ExternalPoi,
  type LandCoverInfo,
  type AirQualityInfo,
  type FloodRiskInfo,
  type WikidataNearbyItem,
} from "@/lib/types"

type BuildContextResult = {
  context: ContextData
  overpassOk: boolean
  overpassError: string | null
  warnings: string[]
}

export async function buildContext(
  lat: number,
  lon: number,
  radius: number
): Promise<BuildContextResult> {
  const warnings: string[] = []

  const reverse = await reverseGeocode(lat, lon).catch(() => null)
  const placeName = reverse?.display_name ?? reverse?.name ?? null
  const placeMeta = {
    category: reverse?.category ?? null,
    addressLine: reverse?.address_line ?? reverse?.display_name ?? null,
    municipality: reverse?.municipality ?? null,
    type: reverse?.type ?? null,
    displayName: reverse?.display_name ?? null,
  }
  const admin = normalizeAdmin(reverse)

  let overpassPois: OverpassPoi[] = []
  let overpassOk = false
  let overpassError: string | null = null
  try {
    overpassPois = await fetchOverpassPois(lat, lon, radius)
    overpassOk = true
  } catch {
    overpassOk = false
    overpassError = "Overpass no disponible"
    warnings.push(overpassError)
  }

  const [
    urban,
    floodRaw,
    airRaw,
    waterways,
    wikidata,
    wikidataNearby,
    wikipediaNearby,
    geoapifyPois,
    landuseOsm,
    openMeteo,
  ] = await Promise.all([
    capasUrbanismo(lat, lon).catch(() => null),
    riesgoInundacion(lat, lon).catch(() => null),
    aireContaminacion(lat, lon).catch(() => null),
    fetchNearestWaterways(lat, lon, Math.min(radius * 2, 4000)).catch(() => []),
    fetchWikidataInfo(lat, lon, radius, placeName).catch(() => null),
    fetchWikidataNearby(lat, lon, radius, 8).catch(() => []),
    fetchWikipediaNearby(lat, lon, Math.min(radius * 2, 4000), 8).catch(
      () => []
    ),
    fetchGeoapifyPlaces(lat, lon, radius, 60).catch(() => []),
    fetchLanduseSummary(lat, lon, Math.min(radius * 2, 2500)).catch(() => null),
    fetchOpenMeteoWeather(lat, lon).catch(() => null),
  ])

  const landCover: LandCoverInfo | null = urban?.land_cover ?? null
  const floodRisk = ensureFloodRisk(floodRaw)
  const airQuality = ensureAirQuality(airRaw)

  const landuseSummary =
    urban?.landuse_summary ?? (landCover ? `CLC: ${landCover.label}` : null)

  const nearestWaterways = waterways ?? []
  const isCoastal = nearestWaterways.some((item) =>
    item.type.toLowerCase().includes("coastline")
  )
  const floodRiskWithProxy = applyFloodProxy(floodRisk, nearestWaterways)

  if (!landCover && !landuseOsm?.summary) {
    warnings.push("Sin datos de uso del suelo CLC/OSM")
  }
  if (!floodRiskWithProxy.ok) {
    warnings.push("Servicio de inundacion no disponible")
  } else if (floodRiskWithProxy.status === "VISUAL_ONLY") {
    warnings.push("Riesgo inundacion disponible solo como capa visual")
  }
  if (!airQuality.ok) {
    warnings.push("Servicio CAMS no disponible")
  } else if (airQuality.status === "VISUAL_ONLY") {
    warnings.push("Calidad del aire disponible solo como capa visual")
  }

  const sources = {
    osm: { nominatim: Boolean(placeName), overpass: overpassOk },
    ign: {
      layers: ["IGNBaseTodo", "PNOA"],
      flood_wms: floodRiskWithProxy.source === "MITECO",
    },
    copernicus: {
      corine: Boolean(landCover),
      efas: floodRiskWithProxy.source === "Copernicus",
      cams: airQuality.ok,
    },
    wikidata: Boolean(wikidata || (wikidataNearby?.length ?? 0) > 0),
    geoapify: geoapifyPois.length > 0,
    wikipedia: (wikipediaNearby?.length ?? 0) > 0,
    open_meteo: Boolean(openMeteo?.weather || openMeteo?.elevation_m != null),
  }

  const basePois = buildPoisFromOverpass(lat, lon, radius, overpassPois)
  const externalPois = [
    ...geoapifyPois,
    ...mapWikidataPois(wikidataNearby, lat, lon),
  ]
  const mappedExternal = mapExternalPoisToCategories(externalPois, {
    lat,
    lon,
  })
  const mergedPois = mergePois(basePois.pois, mappedExternal.mapped)
  const poiSummary = buildPoiSummary(mergedPois)

  if (!overpassOk && mergedPois.restaurants.length === 0) {
    warnings.push("POIs limitados: usando fuentes alternativas")
  }

  const contextData: ContextData = {
    center: { lat, lon },
    radius_m: radius,
    place: {
      name: placeName,
      category: placeMeta.category,
      addressLine: placeMeta.addressLine,
      municipality: placeMeta.municipality,
      type: placeMeta.type ?? null,
      displayName: placeMeta.displayName ?? null,
    },
    admin,
    poi_summary: poiSummary,
    sources,
    wikidata,
    wikidata_nearby: wikidataNearby,
    wikipedia_nearby: wikipediaNearby,
    external_pois: mappedExternal.extras,
    land_cover: landCover,
    flood_risk: floodRiskWithProxy,
    air_quality: airQuality,
    environment: {
      landuse_summary: landuseSummary,
      landuse_osm_summary: landuseOsm?.summary ?? null,
      landuse_osm_counts: landuseOsm?.counts ?? undefined,
      nearest_waterways: nearestWaterways,
      elevation_m: openMeteo?.elevation_m ?? wikidata?.elevation_m ?? null,
      is_coastal: nearestWaterways.length > 0 ? isCoastal : null,
      weather: openMeteo?.weather ?? null,
    },
    risks: buildRiskSummary(floodRiskWithProxy, airQuality),
    pois: mergedPois,
    comparison: null,
  }

  return {
    context: contextData,
    overpassOk,
    overpassError,
    warnings,
  }
}

function ensureFloodRisk(value: FloodRiskInfo | null): FloodRiskInfo {
  if (value) return value
  return {
    ok: false,
    status: "DOWN",
    source: "MITECO",
    risk_level: "desconocido",
    details: "Servicio no disponible",
    layers_hit: [],
  }
}

function ensureAirQuality(value: AirQualityInfo | null): AirQualityInfo {
  if (value) return value
  return {
    ok: false,
    status: "DOWN",
    source: "Copernicus",
    metric: "CAMS",
    unit: null,
    units: null,
    details: "Servicio no disponible",
    layer: null,
  }
}

function buildRiskSummary(
  flood: FloodRiskInfo | null,
  air: AirQualityInfo | null
): ContextData["risks"] {
  const floodFallback = ensureFloodRisk(flood)
  const airFallback = ensureAirQuality(air)

  return {
    flood: {
      source: floodFallback.source,
      status: floodFallback.status,
      notes: floodFallback.details,
      layer_enabled_supported: true,
    },
    air: {
      source: airFallback.source,
      status: airFallback.status,
      notes: airFallback.details,
      layer_enabled_supported: true,
    },
  }
}

function buildPoisFromOverpass(
  lat: number,
  lon: number,
  radius: number,
  rawPois: OverpassPoi[]
) {
  const pois = createEmptyPois()

  const items = rawPois
    .map((poi) => {
      const distance = Math.round(distanceMeters(lat, lon, poi.lat, poi.lon))
      return { ...poi, distance_m: distance }
    })
    .filter((poi) => poi.distance_m <= radius)

  for (const poi of items) {
    const item = {
      name: poi.name,
      distance_m: poi.distance_m,
      lat: poi.lat,
      lon: poi.lon,
      type: poi.type,
      source: "OSM" as const,
    }

    switch (poi.type) {
      case "restaurant":
      case "fast_food":
        pois.restaurants.push(item)
        break
      case "bar":
      case "club":
        pois.bars_and_clubs.push(item)
        break
      case "cafe":
        pois.cafes.push(item)
        break
      case "pharmacy":
        pois.pharmacies.push(item)
        break
      case "hospital":
        pois.hospitals.push(item)
        break
      case "school":
        pois.schools.push(item)
        break
      case "supermarket":
        pois.supermarkets.push(item)
        break
      case "bus_stop":
        pois.transport.push(item)
        break
      case "hotel":
        pois.hotels.push(item)
        break
      case "attraction":
        pois.tourism.push(item)
        break
      case "museum":
        pois.museums.push(item)
        break
      case "viewpoint":
        pois.viewpoints.push(item)
        break
      default:
        break
    }
  }

  return { pois: sortPois(pois) }
}

function mapWikidataPois(
  items: WikidataNearbyItem[],
  lat: number,
  lon: number
): ExternalPoi[] {
  if (!items || items.length === 0) return []
  return items.map((item) => ({
    name: item.label || `Elemento ${item.id}`,
    source: "Wikidata" as const,
    category: item.types[0] ?? null,
    distance_m:
      typeof item.distance_m === "number"
        ? item.distance_m
        : item.coordinates
          ? Math.round(
              distanceMeters(
                lat,
                lon,
                item.coordinates.lat,
                item.coordinates.lon
              )
            )
          : null,
    lat: item.coordinates?.lat ?? null,
    lon: item.coordinates?.lon ?? null,
    kinds: item.types,
    url: item.wikipedia_url ?? item.wikidata_url,
    raw: item,
  }))
}

function normalizeAdmin(reverse: Awaited<ReturnType<typeof reverseGeocode>>) {
  const address = reverse?.address
  const admin: AdminInfo = {
    municipality: reverse?.municipality ?? null,
    district: address?.city_district ?? address?.suburb ?? null,
    province: address?.state_district ?? address?.county ?? null,
    region: address?.state ?? address?.region ?? null,
    country: address?.country ?? null,
    postcode: address?.postcode ?? null,
    road: address?.road ?? null,
    road_type: address?.road ? inferRoadType(address.road) : null,
    house_number: address?.house_number ?? null,
    neighbourhood: address?.neighbourhood ?? null,
    county: address?.county ?? null,
    state: address?.state ?? null,
  }
  return admin
}

function inferRoadType(road: string) {
  const normalized = road.toLowerCase()
  if (normalized.startsWith("calle")) return "calle"
  if (normalized.startsWith("avenida")) return "avenida"
  if (normalized.startsWith("av.")) return "avenida"
  if (normalized.startsWith("plaza")) return "plaza"
  if (normalized.startsWith("carretera")) return "carretera"
  if (normalized.startsWith("camino")) return "camino"
  if (normalized.startsWith("paseo")) return "paseo"
  if (normalized.startsWith("ronda")) return "ronda"
  if (normalized.startsWith("travesia")) return "travesia"
  return "via"
}

function applyFloodProxy(
  flood: FloodRiskInfo,
  waterways: Array<{ name: string | null; type: string; distance_m: number }>
): FloodRiskInfo {
  if (!waterways || waterways.length === 0) return flood
  const needsProxy =
    !flood.ok ||
    flood.risk_level === "desconocido" ||
    flood.layers_hit.length === 0 ||
    flood.status === "VISUAL_ONLY"
  if (!needsProxy) return flood

  const nearest = waterways[0]
  const label = nearest.name ? nearest.name : nearest.type
  const proxyLine = `Proxy OSM: agua cercana ${label} a ${nearest.distance_m} m.`
  if (flood.details.includes("Proxy OSM")) {
    return flood
  }
  return {
    ...flood,
    details: `${flood.details} ${proxyLine}`.trim(),
  }
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
