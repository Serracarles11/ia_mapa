import { type ComparisonSummary, type ContextData } from "@/lib/types"

export function buildComparisonSummary(
  base: ContextData,
  target: ContextData,
  baseName: string | null,
  targetName: string | null
): ComparisonSummary {
  const baseTotal = getPoiTotal(base)
  const targetTotal = getPoiTotal(target)
  const diff = targetTotal - baseTotal

  const distanceKm = calcDistanceKm(
    base.center.lat,
    base.center.lon,
    target.center.lat,
    target.center.lon
  )

  const highlights: string[] = []
  if (distanceKm != null) {
    highlights.push(`Distancia entre puntos: ${distanceKm.toFixed(2)} km`)
  }
  highlights.push(
    `POIs totales: base ${baseTotal} | comparado ${targetTotal} (${formatDiff(diff)})`
  )
  highlights.push(
    `Riesgo inundacion: base ${formatFlood(base)} | comparado ${formatFlood(target)}`
  )
  highlights.push(
    `Calidad del aire: base ${formatAir(base)} | comparado ${formatAir(target)}`
  )
  highlights.push(
    `Uso del suelo: base ${formatLand(base)} | comparado ${formatLand(target)}`
  )
  highlights.push(
    `Agua cercana: base ${formatWater(base)} | comparado ${formatWater(target)}`
  )
  highlights.push(
    `Zona costera: base ${formatCoastal(base)} | comparado ${formatCoastal(target)}`
  )

  return {
    base: {
      name: baseName,
      coords: { ...base.center },
      radius_m: base.radius_m,
    },
    target: {
      name: targetName,
      coords: { ...target.center },
      radius_m: target.radius_m,
    },
    distance_km: distanceKm,
    poi_totals: {
      base: baseTotal,
      target: targetTotal,
    },
    highlights,
    created_at: new Date().toISOString(),
  }
}

function getPoiTotal(context: ContextData) {
  if (typeof context.poi_summary?.total === "number") {
    return context.poi_summary.total
  }
  const counts = [
    context.pois.restaurants.length,
    context.pois.bars_and_clubs.length,
    context.pois.cafes.length,
    context.pois.pharmacies.length,
    context.pois.hospitals.length,
    context.pois.schools.length,
    context.pois.supermarkets.length,
    context.pois.transport.length,
    context.pois.hotels.length,
    context.pois.tourism.length,
    context.pois.museums.length,
    context.pois.viewpoints.length,
  ]
  return counts.reduce((sum, value) => sum + value, 0)
}

function formatDiff(value: number) {
  if (value > 0) return `+${value}`
  if (value < 0) return `${value}`
  return "0"
}

function formatFlood(context: ContextData) {
  const flood = context.flood_risk
  if (!flood) return "sin datos"
  if (!flood.ok) return `sin datos (${flood.details})`
  if (flood.status === "VISUAL_ONLY") return "solo visual"
  return flood.risk_level
}

function formatAir(context: ContextData) {
  const air = context.air_quality
  if (!air) return "sin datos"
  if (!air.ok) return "no disponible"
  const status = air.status
  return status === "VISUAL_ONLY" ? "CAMS visual" : "CAMS ok"
}

function formatLand(context: ContextData) {
  return context.land_cover?.label ?? "sin datos"
}

function formatWater(context: ContextData) {
  const list = context.environment.nearest_waterways
  if (list.length === 0) return "sin datos"
  const nearest = list[0]
  const label = nearest.name || nearest.type
  return `${label} (${nearest.distance_m} m)`
}

function formatCoastal(context: ContextData) {
  const value = context.environment.is_coastal
  if (value === null) return "sin datos"
  return value ? "si" : "no"
}

function calcDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const km = R * c
  return Number.isFinite(km) ? km : null
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}
