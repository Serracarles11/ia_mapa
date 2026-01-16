import "server-only"

import { type AiReport, type ContextData, type PoiItem } from "@/lib/types"

export function buildFallbackReport(
  context: ContextData,
  placeName: string | null,
  extraLimitations: string[] = []
): AiReport {
  const {
    center,
    radius_m,
    land_cover,
    flood_risk,
    air_quality,
    pois,
    admin,
    environment,
    external_pois,
    wikidata,
    wikipedia_nearby,
    wikidata_nearby,
  } = context
  const coords = `${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`
  const placeLabel = placeName ? `Lugar: ${placeName}.` : "Lugar sin nombre."
  const adminLine = buildAdminLine(admin)
  const populationLine = buildPopulationLine(wikidata?.population ?? null)
  const weatherLine = buildWeatherLine(environment.weather)
  const elevationLine = buildElevationLine(
    environment.elevation_m ?? wikidata?.elevation_m ?? null
  )
  const wikipediaLine = buildWikipediaLine(wikipedia_nearby)
  const wikidataNearbyLine = buildWikidataNearbyLine(wikidata_nearby)
  const externalHighlights = pickExternalHighlights(external_pois ?? [])

  const counts = buildCounts(pois)
  const totalPois = Object.values(counts)
    .filter((value): value is number => typeof value === "number")
    .reduce((sum, value) => sum + value, 0)
  const densityLabel =
    totalPois >= 30 ? "alta" : totalPois >= 12 ? "media" : "baja"
  const topPois = pickTopPois(pois, 6)
  const topLines = topPois.map(
    (poi) => `- ${poi.name} (${poi.type}, ${poi.distance_m} m)`
  )

  const infraestructura = [
    `En el radio de ${Math.round(radius_m)} m se observan: ${counts.summary}.`,
    `La densidad de servicios en el entorno es ${densityLabel}.`,
    topLines.length > 0 ? "Destacados cercanos:" : "Sin destacados cercanos.",
    ...topLines,
    externalHighlights.length > 0
      ? "POIs de fuentes alternativas:"
      : "Sin POIs adicionales en fuentes alternativas.",
    ...externalHighlights,
  ].join("\n")

  const riesgoTexto = flood_risk
    ? flood_risk.ok
      ? `Riesgo ${flood_risk.risk_level}. ${flood_risk.details}`
      : `Riesgo desconocido. ${flood_risk.details}`
    : "No hay datos de inundacion disponibles para este punto."

  const aireTexto = air_quality
    ? air_quality.ok
      ? `Calidad del aire: ${air_quality.details}`
      : `Calidad del aire no disponible. ${air_quality.details}`
    : "Calidad del aire no disponible."

  const usosUrbanos = land_cover
    ? `Uso del suelo dominante segun CLC 2018: ${land_cover.label} (codigo ${land_cover.code}).`
    : "No hay datos de uso del suelo CLC 2018 para este punto."
  const usosOsm = environment.landuse_osm_summary
    ? `Resumen OSM de usos: ${environment.landuse_osm_summary}.`
    : "Resumen OSM de usos: sin datos."

  const recomendacion = buildRecommendation(topPois, counts, densityLabel)

  const fuentes = buildFuentes(context)
  const limitaciones = buildLimitaciones(context, extraLimitations)

  return {
    descripcion_zona: [
      `Punto analizado en ${coords} con radio ${Math.round(radius_m)} m.`,
      placeLabel,
      adminLine,
      populationLine,
      elevationLine,
      weatherLine,
      wikipediaLine,
      wikidataNearbyLine,
      wikidata?.label ? `Wikidata principal: ${wikidata.label}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    infraestructura_cercana: infraestructura,
    riesgos: `${riesgoTexto.trim()} ${aireTexto.trim()}`.trim(),
    usos_urbanos: `${usosUrbanos} ${usosOsm}`.trim(),
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

function buildRecommendation(
  topPois: PoiItem[],
  counts: ReturnType<typeof buildCounts>,
  densityLabel: string
) {
  if (topPois.length === 0) {
    return [
      "En conjunto, el entorno muestra baja densidad de servicios dentro del radio actual.",
      "Si buscas mas opciones, conviene ampliar el radio de analisis.",
    ].join(" ")
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
    `El entorno muestra una densidad ${densityLabel} de servicios: ${counts.summary}.`,
    `Alternativas: ${altText}.`,
  ].join(" ")
}

function buildFuentes(context: ContextData) {
  const sources = context.sources
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
  if (sources.copernicus.efas) {
    list.push("Copernicus EFAS (flood)")
  }
  if (sources.copernicus.cams) {
    list.push("Copernicus CAMS (aire)")
  }
  if (context.wikidata) {
    list.push("Wikidata")
  }
  if (sources.wikipedia) {
    list.push("Wikipedia")
  }
  if (sources.geoapify) {
    list.push("Geoapify Places")
  }
  if (sources.open_meteo) {
    list.push("Open-Meteo")
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
  if (!context.air_quality || !context.air_quality.ok) {
    list.push("Sin datos CAMS de calidad del aire.")
  }
  if (context.risks.air.status === "VISUAL_ONLY") {
    list.push("Calidad del aire disponible solo como capa visual.")
  }
  if (context.risks.flood.status === "VISUAL_ONLY") {
    list.push("Riesgo inundacion disponible solo como capa visual.")
  }
  if (!context.wikidata) {
    list.push("Sin datos Wikidata.")
  }
  if (!context.sources.geoapify) {
    list.push("Sin datos de Geoapify Places.")
  }
  if (!context.sources.wikipedia) {
    list.push("Sin datos de Wikipedia cercana.")
  }
  if (!context.sources.open_meteo) {
    list.push("Sin datos de meteorologia actual (Open-Meteo).")
  }
  if (!hasPois(context)) {
    list.push("Sin POIs disponibles dentro del radio.")
  }
  return list
}

function buildAdminLine(admin: ContextData["admin"]) {
  const roadLine = admin.road
    ? `Via: ${admin.road}${admin.road_type ? ` (${admin.road_type})` : ""}`
    : admin.road_type
      ? `Tipo via: ${admin.road_type}`
      : null
  const parts = [
    roadLine,
    admin.municipality ? `Municipio: ${admin.municipality}` : null,
    admin.district ? `Distrito: ${admin.district}` : null,
    admin.province ? `Provincia: ${admin.province}` : null,
    admin.region ? `Comunidad: ${admin.region}` : null,
    admin.postcode ? `CP: ${admin.postcode}` : null,
    admin.country ? `Pais: ${admin.country}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(". ") + "." : ""
}

function buildPopulationLine(population: number | null) {
  if (typeof population !== "number" || !Number.isFinite(population)) {
    return ""
  }
  return `Poblacion: ${formatNumber(population)}.`
}

function buildElevationLine(elevation: number | null) {
  if (typeof elevation !== "number" || !Number.isFinite(elevation)) {
    return ""
  }
  return `Elevacion: ${formatNumber(elevation)} m.`
}

function buildWeatherLine(weather: ContextData["environment"]["weather"]) {
  if (!weather) return ""
  const parts = [
    weather.description ? `Estado: ${weather.description}` : null,
    weather.temperature_c != null
      ? `Temp: ${formatMetric(weather.temperature_c, "C")}`
      : null,
    weather.wind_kph != null
      ? `Viento: ${formatMetric(weather.wind_kph, "km/h")}`
      : null,
    weather.precipitation_mm != null
      ? `Precipitacion: ${formatMetric(weather.precipitation_mm, "mm")}`
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? `Meteorologia actual: ${parts.join(", ")}.` : ""
}

function buildWikipediaLine(items: ContextData["wikipedia_nearby"]) {
  if (!items || items.length === 0) return ""
  const top = items
    .slice(0, 3)
    .map((item) => {
      const distance =
        item.distance_m != null ? `${item.distance_m} m` : "distancia n/d"
      return `${item.title} (${distance})`
    })
    .join(" | ")
  return top ? `Wikipedia cercana: ${top}.` : ""
}

function buildWikidataNearbyLine(items: ContextData["wikidata_nearby"]) {
  if (!items || items.length === 0) return ""
  const top = items
    .slice(0, 3)
    .map((item) => {
      const distance =
        item.distance_m != null ? `${item.distance_m} m` : "distancia n/d"
      return `${item.label || item.id} (${distance})`
    })
    .join(" | ")
  return top ? `Wikidata cercana: ${top}.` : ""
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMetric(value: number, unit: string) {
  return `${new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1,
  }).format(value)} ${unit}`
}

function pickExternalHighlights(externalPois: ContextData["external_pois"]) {
  if (!externalPois || externalPois.length === 0) return []
  return externalPois.slice(0, 5).map((poi) => {
    const distance =
      typeof poi.distance_m === "number" ? `${poi.distance_m} m` : "distancia n/d"
    const category = poi.category ? ` (${poi.category})` : ""
    return `- ${poi.name}${category} [${poi.source}] ${distance}`
  })
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
