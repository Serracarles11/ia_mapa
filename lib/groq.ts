import "server-only"

const DEFAULT_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const DEFAULT_MODEL = "llama-3.3-70b"

export type AiReport = {
  place_name: string | null
  summary_general: string
  restaurants_nearby: Array<{
    name: string
    distance_m: number
    cuisine: string | null
    rating: number | null
    price_range: string | null
  }>
  ocio_inmediato: Array<{
    name: string
    distance_m: number
    type: "bar" | "cafe" | "club" | "fast_food"
  }>
  services: {
    pharmacies: Array<{ name: string; distance_m: number }>
    hospitals: Array<{ name: string; distance_m: number }>
    schools: Array<{ name: string; distance_m: number }>
    bus_stops: Array<{ name: string; distance_m: number }>
    supermarkets: Array<{ name: string; distance_m: number }>
  }
  tourism: {
    hotels: Array<{ name: string; distance_m: number }>
    museums: Array<{ name: string; distance_m: number }>
    attractions: Array<{ name: string; distance_m: number }>
    viewpoints: Array<{ name: string; distance_m: number }>
  }
  limited_info: {
    is_limited: boolean
    reason: string | null
  }
}

export type AiReportResult = {
  report: AiReport
  warning?: string
}

export const systemPrompt =
  "Eres un analista territorial y urbano experto. Responde SIEMPRE en castellano de Espana con lenguaje claro, natural y explicativo. Usa EXCLUSIVAMENTE el JSON de contexto (OSM). Prohibido usar conocimiento externo o mencionar lugares fuera del radio. No inventes nombres, servicios, valoraciones ni caracteristicas: solo usa los nombres y atributos presentes en las listas. Si un dato no existe, indicalo explicitamente. Ordena los POIs por distance_m ascendente. Cada POI debe incluir distance_m. Usa [] si una categoria no tiene datos. limited_info.is_limited solo puede ser true si TODAS las categorias de POIs estan vacias. Devuelve SOLO un JSON VALIDO (sin texto adicional ni markdown). Usa comillas dobles, sin comas finales y sin comentarios. No incluyas claves adicionales ni ejemplos. En summary_general, evita listas simples: ofrece una respuesta razonada que ayude a decidir, comparando opciones con distancia, tipo y datos disponibles. Si preguntan por 'mejor' o 'recomendado', elige una opcion principal cuando sea posible, explica por que, compara con 1-2 alternativas cercanas y menciona limitaciones de datos si existen. Si los datos son incompletos, dilo claramente y razona solo con lo que se sabe."

const strictSystemPrompt = `${systemPrompt} Si no puedes cumplir, devuelve el JSON con arrays vacios y limited_info.is_limited true.`

export async function generateAiReport(
  contextData: unknown
): Promise<AiReportResult> {
  return generateAiReportSafe(contextData)
}

export async function generateAiReportSafe(
  contextData: unknown
): Promise<AiReportResult> {
  const apiKey = process.env.GROQ_API_KEY
  const apiUrl = process.env.GROQ_API_URL || DEFAULT_API_URL
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    return {
      report: buildFallbackReportFromContext(
        contextData,
        "GROQ_API_KEY missing"
      ),
      warning: "GROQ_API_KEY missing",
    }
  }

  const compact = compactContext(contextData, 20)
  const primaryPrompt = buildUserPrompt(compact, "primary")

  const primary = await callGroq(
    apiUrl,
    apiKey,
    model,
    systemPrompt,
    primaryPrompt,
    1200
  )
  if (primary.ok) {
    return primary.result
  }

  const reduced = compactContext(contextData, 8)
  const fallbackPrompt = buildUserPrompt(reduced, "strict")
  const retry = await callGroq(
    apiUrl,
    apiKey,
    model,
    strictSystemPrompt,
    fallbackPrompt,
    700
  )
  if (retry.ok) {
    return retry.result
  }

  return {
    report: buildFallbackReportFromContext(contextData, "Groq no disponible"),
    warning: retry.error || primary.error || "Groq no disponible",
  }
}

export function safeJsonParse(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) return null
    const slice = text.slice(start, end + 1)
    try {
      return JSON.parse(slice)
    } catch {
      return null
    }
  }
}

function buildFallbackReportFromContext(
  contextData: unknown,
  reason: string
): AiReport {
  const context = (contextData ?? {}) as {
    radius_m?: number
    pois?: Record<string, Array<{ name?: string; distance_m?: number; type?: string }>>
  }
  const pois = context.pois || {}
  const rawRestaurants = Array.isArray(pois.restaurants) ? pois.restaurants : []
  const rawBars = Array.isArray(pois.bars_and_clubs) ? pois.bars_and_clubs : []

  const restaurants = normalizeRestaurantArrayOrEmpty(pois.restaurants)
  const bars = normalizePoiArrayOrEmpty(pois.bars_and_clubs)
  const cafes = normalizePoiArrayOrEmpty(pois.cafes)
  const pharmacies = normalizePoiArrayOrEmpty(pois.pharmacies)
  const hospitals = normalizePoiArrayOrEmpty(pois.hospitals)
  const schools = normalizePoiArrayOrEmpty(pois.schools)
  const supermarkets = normalizePoiArrayOrEmpty(pois.supermarkets)
  const transport = normalizePoiArrayOrEmpty(pois.transport)
  const hotels = normalizePoiArrayOrEmpty(pois.hotels)
  const tourism = normalizePoiArrayOrEmpty(pois.tourism)
  const museums = normalizePoiArrayOrEmpty(pois.museums)
  const viewpoints = normalizePoiArrayOrEmpty(pois.viewpoints)

  const ocio = [
    ...bars.map((item) => {
      const source = rawBars.find((poi) => poi?.name === item.name)
      const type = source?.type === "club" ? "club" : "bar"
      return { ...item, type }
    }),
    ...cafes.map((item) => ({ ...item, type: "cafe" as const })),
    ...restaurants
      .filter((item) => {
        const source = rawRestaurants.find(
          (poi) => poi?.name === item.name
        )
        return source?.type === "fast_food"
      })
      .map((item) => ({ ...item, type: "fast_food" as const })),
  ].sort((a, b) => a.distance_m - b.distance_m)

  const summaryParts = [
    `Restaurantes: ${restaurants.length}`,
    `Bares/clubes: ${bars.length}`,
    `Cafes: ${cafes.length}`,
    `Supermercados: ${supermarkets.length}`,
    `Paradas de bus: ${transport.length}`,
    `Hoteles: ${hotels.length}`,
    `Atracciones: ${tourism.length}`,
  ]

  const report: AiReport = {
    place_name: null,
    summary_general: `Resumen basado en datos OSM. ${summaryParts.join(". ")}.`,
    restaurants_nearby: restaurants,
    ocio_inmediato: ocio,
    services: {
      pharmacies,
      hospitals,
      schools,
      bus_stops: transport,
      supermarkets,
    },
    tourism: {
      hotels,
      museums,
      attractions: tourism,
      viewpoints,
    },
    limited_info: {
      is_limited: false,
      reason: null,
    },
  }

  const isLimited = computeIsLimited(report)
  report.limited_info = {
    is_limited: isLimited,
    reason: isLimited ? reason : null,
  }

  return report
}

function buildUserPrompt(
  contextData: unknown,
  mode: "primary" | "strict"
) {
  const schemaDescription = [
    "place_name: string|null",
    "summary_general: string",
    "restaurants_nearby: Array<{name:string, distance_m:number, cuisine:string|null, rating:number|null, price_range:string|null}>",
    'ocio_inmediato: Array<{name:string, distance_m:number, type:"bar"|"cafe"|"club"|"fast_food"}>',
    "services: { pharmacies, hospitals, schools, bus_stops, supermarkets } (arrays de {name, distance_m})",
    "tourism: { hotels, museums, attractions, viewpoints } (arrays de {name, distance_m})",
    "limited_info: { is_limited:boolean, reason:string|null }",
  ].join("\n")

  return [
    "Contexto JSON (datos reales OSM):",
    JSON.stringify(contextData),
    "",
    "Esquema JSON requerido:",
    schemaDescription,
    "",
    "Reglas:",
    "- Responde solo en castellano de Espana, aunque el usuario pregunte en otro idioma.",
    "- Devuelve SOLO JSON valido (sin texto ni markdown).",
    "- Si una categoria no tiene datos, usa [].",
    "- No inventes nombres ni atributos.",
    "- No incluyas lugares fuera del radio.",
    "- Ordena los POIs por distance_m ascendente.",
    "- limited_info.is_limited solo es true si TODAS las categorias estan vacias.",
    "- Devuelve SOLO JSON valido, sin texto adicional.",
    "- No incluyas claves adicionales.",
    mode === "strict"
      ? "- Si hay dudas, devuelve arrays vacios y limited_info.is_limited true."
      : "",
  ].join("\n")
}

async function callGroq(
  apiUrl: string,
  apiKey: string,
  model: string,
  systemPromptText: string,
  userPrompt: string,
  maxTokens: number
): Promise<{ ok: true; result: AiReportResult } | { ok: false; error?: string }> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPromptText },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return { ok: false, error: errorText }
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const text = data?.choices?.[0]?.message?.content || ""
  if (!text.trim()) {
    return { ok: false, error: "Empty content from model" }
  }

  const reportJson = safeJsonParse(text)
  if (!reportJson) {
    return { ok: false, error: "Invalid JSON from model" }
  }

  const validation = normalizeAiReport(reportJson)
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }

  return { ok: true, result: { report: validation.report } }
}

function compactContext(contextData: unknown, limit: number) {
  if (!contextData || typeof contextData !== "object") return contextData
  const data = contextData as Record<string, unknown>
  const pois = isRecord(data.pois) ? data.pois : {}

  const pickList = (items: unknown[] | undefined) => {
    type PickedItem = {
      name: string
      distance_m: number
      type?: unknown
      cuisine?: string | null
      rating?: number | null
      price_range?: string | null
    }
    if (!Array.isArray(items)) return []
    return items
      .filter(
        (item): item is Record<string, unknown> =>
          isRecord(item) && typeof item.name === "string"
      )
      .map((item) => {
        const distance = getNumber(item.distance_m)
        const entry: Omit<PickedItem, "distance_m"> & { distance_m: number | null } = {
          name: item.name as string,
          distance_m: distance,
          type: item.type,
        }
        const cuisine = getNullableString(item.cuisine)
        if (cuisine !== undefined) entry.cuisine = cuisine
        const rating = getNullableNumber(item.rating)
        if (rating !== undefined) entry.rating = rating
        const priceRange = getNullableString(item.price_range)
        if (priceRange !== undefined) entry.price_range = priceRange
        return entry
      })
      .filter((item): item is PickedItem => typeof item.distance_m === "number")
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit)
  }

  return {
    center: data.center,
    radius_m: data.radius_m,
    is_touristic_area: data.is_touristic_area,
    pois: {
      restaurants: pickList(getArray(pois.restaurants)),
      bars_and_clubs: pickList(getArray(pois.bars_and_clubs)),
      cafes: pickList(getArray(pois.cafes)),
      pharmacies: pickList(getArray(pois.pharmacies)),
      hospitals: pickList(getArray(pois.hospitals)),
      schools: pickList(getArray(pois.schools)),
      supermarkets: pickList(getArray(pois.supermarkets)),
      transport: pickList(getArray(pois.transport)),
      hotels: pickList(getArray(pois.hotels)),
      tourism: pickList(getArray(pois.tourism)),
      museums: pickList(getArray(pois.museums)),
      viewpoints: pickList(getArray(pois.viewpoints)),
    },
  }
}

function normalizeAiReport(
  value: unknown
):
  | { ok: true; report: AiReport }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Report is not an object" }
  }

  const raw = value as Record<string, unknown>
  const summary =
    typeof raw.summary_general === "string" ? raw.summary_general : null
  if (!summary) {
    return { ok: false, error: "summary_general missing" }
  }

  const restaurants = normalizeRestaurantArray(raw.restaurants_nearby)
  const ocio = normalizeOcioArray(raw.ocio_inmediato)
  if (!restaurants || !ocio) {
    return { ok: false, error: "Invalid restaurants or ocio list" }
  }

  const normalizeCategory = (
    source: unknown,
    key: string
  ): Array<{ name: string; distance_m: number }> => {
    if (!isRecord(source)) return []
    const value = source[key]
    return normalizePoiArray(value) ?? []
  }

  const services = {
    pharmacies: normalizeCategory(raw.services, "pharmacies"),
    hospitals: normalizeCategory(raw.services, "hospitals"),
    schools: normalizeCategory(raw.services, "schools"),
    bus_stops: normalizeCategory(raw.services, "bus_stops"),
    supermarkets: normalizeCategory(raw.services, "supermarkets"),
  }

  const tourism = {
    hotels: normalizeCategory(raw.tourism, "hotels"),
    museums: normalizeCategory(raw.tourism, "museums"),
    attractions: normalizeCategory(raw.tourism, "attractions"),
    viewpoints: normalizeCategory(raw.tourism, "viewpoints"),
  }

  const servicesSorted = {
    pharmacies: sortByDistance(services.pharmacies),
    hospitals: sortByDistance(services.hospitals),
    schools: sortByDistance(services.schools),
    bus_stops: sortByDistance(services.bus_stops),
    supermarkets: sortByDistance(services.supermarkets),
  }

  const tourismSorted = {
    hotels: sortByDistance(tourism.hotels),
    museums: sortByDistance(tourism.museums),
    attractions: sortByDistance(tourism.attractions),
    viewpoints: sortByDistance(tourism.viewpoints),
  }

  const placeName =
    typeof raw.place_name === "string" ? raw.place_name : null

  const report: AiReport = {
    place_name: placeName,
    summary_general: summary,
    restaurants_nearby: sortByDistance(restaurants),
    ocio_inmediato: sortByDistance(ocio),
    services: servicesSorted,
    tourism: tourismSorted,
    limited_info: {
      is_limited: false,
      reason: null,
    },
  }

  const isLimited = computeIsLimited(report)
  const limitedReason = isRecord(raw.limited_info)
    ? raw.limited_info.reason
    : null

  report.limited_info = {
    is_limited: isLimited,
    reason:
      isLimited && typeof limitedReason === "string"
        ? limitedReason
        : isLimited
          ? "Datos insuficientes"
          : null,
  }

  return { ok: true, report }
}

function normalizePoiArray(
  value: unknown
): Array<{ name: string; distance_m: number }> | null {
  if (!Array.isArray(value)) return null
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const name = getString(item.name)
      const distance = getNumber(item.distance_m)
      if (!name || typeof distance !== "number") return null
      return { name, distance_m: distance }
    })
    .filter(
      (item): item is { name: string; distance_m: number } => Boolean(item)
    )
}

function normalizeRestaurantArray(
  value: unknown
):
  | Array<{
      name: string
      distance_m: number
      cuisine: string | null
      rating: number | null
      price_range: string | null
    }>
  | null {
  if (!Array.isArray(value)) return null
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const name = getString(item.name)
      const distance = getNumber(item.distance_m)
      if (!name || typeof distance !== "number") return null
      const cuisine = getString(item.cuisine)
      const rating = getNumber(item.rating)
      const priceRange = getString(item.price_range)
      return {
        name,
        distance_m: distance,
        cuisine,
        rating,
        price_range: priceRange,
      }
    })
    .filter(
      (
        item
      ): item is {
        name: string
        distance_m: number
        cuisine: string | null
        rating: number | null
        price_range: string | null
      } => Boolean(item)
    )
}

function normalizeRestaurantArrayOrEmpty(
  value: unknown
):
  Array<{
    name: string
    distance_m: number
    cuisine: string | null
    rating: number | null
    price_range: string | null
  }> {
  return normalizeRestaurantArray(value) ?? []
}

function normalizePoiArrayOrEmpty(
  value: unknown
): Array<{ name: string; distance_m: number }> {
  return normalizePoiArray(value) ?? []
}

function normalizeOcioArray(
  value: unknown
): Array<{ name: string; distance_m: number; type: "bar" | "cafe" | "club" | "fast_food" }> | null {
  if (!Array.isArray(value)) return null
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const name = getString(item.name)
      const distance = getNumber(item.distance_m)
      const type = item.type
      if (!name || typeof distance !== "number") return null
      if (
        type !== "bar" &&
        type !== "cafe" &&
        type !== "club" &&
        type !== "fast_food"
      )
        return null
      return { name, distance_m: distance, type }
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

function sortByDistance<T extends { distance_m: number }>(items: T[]) {
  return [...items].sort((a, b) => a.distance_m - b.distance_m)
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

function getArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function getNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value === "string") return value
  return undefined
}

function getNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === "number") return value
  return undefined
}
