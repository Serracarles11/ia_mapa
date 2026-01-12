import "server-only"

import { type AiReport, type ContextData, type PoiItem } from "@/lib/types"

export function buildFallbackReport(
  context: ContextData,
  placeName: string | null,
  extraLimitations: string[] = []
): AiReport {
  const { center, radius_m, land_cover, flood_risk, pois, sources } = context
  const coords = `${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`
  const placeLabel = placeName ? `Lugar: ${placeName}.` : "Lugar sin nombre."

  const counts = buildCounts(pois)
  const topPois = pickTopPois(pois, 6)
  const topLines = topPois.map(
    (poi) => `- ${poi.name} (${poi.type}, ${poi.distance_m} m)`
  )

  const infraestructura = [
    `En el radio de ${Math.round(radius_m)} m se observan: ${counts.summary}.`,
    topLines.length > 0 ? "Destacados cercanos:" : "Sin destacados cercanos.",
    ...topLines,
  ].join("\n")

  const riesgoTexto = flood_risk
    ? flood_risk.ok
      ? `Riesgo ${flood_risk.risk_level}. ${flood_risk.details}`
      : `Riesgo desconocido. ${flood_risk.details}`
    : "No hay datos de inundacion disponibles para este punto."

  const usosUrbanos = land_cover
    ? `Uso del suelo dominante segun CLC 2018: ${land_cover.label} (codigo ${land_cover.code}).`
    : "No hay datos de uso del suelo CLC 2018 para este punto."

  const recomendacion = buildRecommendation(topPois, counts)

  const fuentes = buildFuentes(sources)
  const limitaciones = buildLimitaciones(context, extraLimitations)

  return {
    descripcion_zona: `Punto analizado en ${coords} con radio ${Math.round(
      radius_m
    )} m. ${placeLabel}`,
    infraestructura_cercana: infraestructura,
    riesgos: riesgoTexto.trim(),
    usos_urbanos: usosUrbanos,
    recomendacion_final: recomendacion,
    fuentes,
    limitaciones,
  }
}

function buildCounts(pois: ContextData["pois"]) {
  const counts = {
    restaurantes: pois.restaurants.length,
    bares: pois.bars_and_clubs.length,
    cafes: pois.cafes.length,
    supermercados: pois.supermarkets.length,
    transporte: pois.transport.length,
    hoteles: pois.hotels.length,
    turismo:
      pois.tourism.length + pois.museums.length + pois.viewpoints.length,
  }

  const summaryParts = Object.entries(counts)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ")

  return { ...counts, summary: summaryParts }
}

function pickTopPois(pois: ContextData["pois"], limit: number): PoiItem[] {
  const all = [
    ...pois.restaurants,
    ...pois.bars_and_clubs,
    ...pois.cafes,
    ...pois.supermarkets,
    ...pois.transport,
    ...pois.hotels,
    ...pois.tourism,
    ...pois.museums,
    ...pois.viewpoints,
    ...pois.pharmacies,
    ...pois.hospitals,
    ...pois.schools,
  ]

  return [...all].sort((a, b) => a.distance_m - b.distance_m).slice(0, limit)
}

function buildRecommendation(topPois: PoiItem[], counts: ReturnType<typeof buildCounts>) {
  if (topPois.length === 0) {
    return "No hay POIs suficientes en el radio para recomendar ubicaciones concretas."
  }

  const primary = topPois[0]
  const alternatives = topPois.slice(1, 3)

  const altText = alternatives.length
    ? alternatives
        .map((poi) => `${poi.name} (${poi.type}, ${poi.distance_m} m)`)
        .join(" | ")
    : "Sin alternativas cercanas adicionales."

  return [
    `Opcion principal: ${primary.name} (${primary.type}, ${primary.distance_m} m).`,
    `Hay oferta cerca: ${counts.summary}.`,
    `Alternativas: ${altText}.`,
  ].join(" ")
}

function buildFuentes(sources: ContextData["sources"]) {
  const list: string[] = []
  if (sources.osm.nominatim || sources.osm.overpass) {
    list.push("OpenStreetMap (Nominatim/Overpass)")
  }
  if (sources.ign.layers.length > 0 || sources.ign.flood_wms) {
    list.push("IGN / MAPA (WMS)")
  }
  if (sources.copernicus.corine) {
    list.push("Copernicus CLC 2018")
  }
  return list
}

function buildLimitaciones(
  context: ContextData,
  extraLimitations: string[]
) {
  const list = [...extraLimitations]
  if (!context.land_cover) {
    list.push("Sin datos de uso del suelo CLC 2018.")
  }
  if (!context.flood_risk || !context.flood_risk.ok) {
    list.push("Sin datos de riesgo de inundacion del WMS oficial.")
  }
  if (!hasPois(context)) {
    list.push("Sin POIs disponibles dentro del radio.")
  }
  return list
}

function hasPois(context: ContextData) {
  const p = context.pois
  return (
    p.restaurants.length > 0 ||
    p.bars_and_clubs.length > 0 ||
    p.cafes.length > 0 ||
    p.pharmacies.length > 0 ||
    p.hospitals.length > 0 ||
    p.schools.length > 0 ||
    p.supermarkets.length > 0 ||
    p.transport.length > 0 ||
    p.hotels.length > 0 ||
    p.tourism.length > 0 ||
    p.museums.length > 0 ||
    p.viewpoints.length > 0
  )
}
