import { NextResponse } from "next/server"
import { safeJsonParse, type AiReport } from "@/lib/groq"

type ContextPoiBase = {
  name: string
  distance_m: number
  rating?: number | null
}

type ContextData = {
  center: { lat: number; lon: number }
  radius_m: number
  is_touristic_area: boolean
  pois: {
    restaurants: Array<ContextPoiBase & { type: "restaurant" | "fast_food" }>
    bars_and_clubs: Array<ContextPoiBase & { type: "bar" | "club" }>
    cafes: Array<ContextPoiBase & { type: "cafe" }>
    pharmacies: Array<ContextPoiBase & { type: "pharmacy" }>
    hospitals: Array<ContextPoiBase & { type: "hospital" }>
    schools: Array<ContextPoiBase & { type: "school" }>
    supermarkets: Array<ContextPoiBase & { type: "supermarket" }>
    transport: Array<ContextPoiBase & { type: "bus_stop" }>
    hotels: Array<ContextPoiBase & { type: "hotel" }>
    tourism: Array<ContextPoiBase & { type: "attraction" }>
    museums: Array<ContextPoiBase & { type: "museum" }>
    viewpoints: Array<ContextPoiBase & { type: "viewpoint" }>
  }
}

type PlaceChatRequest = {
  contextData?: ContextData | null
  aiReport?: AiReport | null
  question?: string
  status?: "OK" | "NO_POIS" | "OVERPASS_DOWN"
}

type SourcesUsed = {
  restaurants: number
  bars_and_clubs: number
  cafes: number
  supermarkets: number
  transport: number
  hotels: number
  tourism: number
}

type PlaceChatResponse = {
  answer: string
  sources_used: SourcesUsed
  limits?: string[]
}

const DEFAULT_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const DEFAULT_MODEL = "llama-3.3-70b"

const chatSystemPrompt =
  "Eres un asistente para responder preguntas sobre un lugar concreto. Responde SIEMPRE en castellano, con lenguaje claro, natural y orientado a usuario final. Usa EXCLUSIVAMENTE el contexto recibido (POIs, distance_m, type). Está PROHIBIDO inventar datos (tapas, ratings, ambiente, precios, horarios, servicios o características no presentes en el contexto) o mencionar lugares fuera del radio. Si algo no está en los datos, indícalo claramente. Tu objetivo principal es AYUDAR A DECIDIR, no solo listar información. Nunca respondas solo con listas ni con frases vagas. Cuando el usuario pregunte algo como: - “mejor” - “recomendado” - “cuál elegir” - “qué merece la pena” - “dónde ir” DEBES seguir SIEMPRE este proceso: 1. Elegir UNA opción principal si existe al menos un POI relevante. 2. Explicar por qué esa opción es la mejor usando: - distance_m - tipo de local - cercanía relativa frente a otros POIs similares. 3. Compararla con 1–2 alternativas cercanas (si existen). 4. Indicar claramente las limitaciones de los datos cuando apliquen. CASO ESPECIAL: TAPAS Si el usuario pregunta por “tapas” y NO hay datos explícitos de tapas: - Indica claramente que no hay información específica sobre tapas. - AUN ASÍ: - Recomienda el bar más cercano o mejor posicionado según distancia y tipo. - Explica por qué es la opción más razonable con los datos disponibles. - Compárala con 1–2 alternativas cercanas. - NO respondas nunca solo con “no hay datos”. FORMATO OBLIGATORIO DE RESPUESTA (texto normal, no JSON): Recomendación principal: (nombre + distancia) Por qué: (explicación clara en frases o viñetas, basada solo en los datos) Alternativas: (1–2 opciones cercanas con breve comparación) Limitaciones: (solo si aplican, de forma honesta y clara) Prohibiciones estrictas: - No inventar conclusiones ni atributos. - No responder solo con listas. - No decir “no se puede determinar” si hay POIs relevantes en el contexto. - Solo indicar información insuficiente cuando realmente no haya datos útiles."

const chatStrictSystemPrompt = `${chatSystemPrompt} Si no puedes responder con datos reales, devuelve la frase exacta y un limits claro.`

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PlaceChatRequest
  const question =
    typeof body.question === "string" ? body.question.trim() : ""
  const contextData = body.contextData ?? null
  const aiReport = body.aiReport ?? null
  const status = body.status

  if (!question) {
    return NextResponse.json(
      { ok: false, error: "Missing question" },
      { status: 400 }
    )
  }

  if (status === "OVERPASS_DOWN" || !contextData) {
    console.debug("Chat fallback: Overpass down or missing context")
    return NextResponse.json(buildOverpassDownResponse())
  }

  const apiKey = process.env.GROQ_API_KEY
  const apiUrl = process.env.GROQ_API_URL || DEFAULT_API_URL
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL

  const availableCounts = buildAvailableCounts(contextData)

  if (!apiKey) {
    const fallback = buildFallbackChat(contextData, question)
    return NextResponse.json(fallback)
  }

  const primaryPrompt = buildChatPrompt(contextData, aiReport, question, "primary")
  const primary = await callGroqChat(
    apiUrl,
    apiKey,
    model,
    chatSystemPrompt,
    primaryPrompt,
    900,
    availableCounts
  )
  if (primary.ok) {
    const fallbackCandidate = buildFallbackChat(contextData, question)
    if (shouldOverrideNoData(primary.result.answer, fallbackCandidate.answer)) {
      return NextResponse.json(fallbackCandidate)
    }
    return NextResponse.json(primary.result)
  }

  const strictPrompt = buildChatPrompt(contextData, aiReport, question, "strict")
  const retry = await callGroqChat(
    apiUrl,
    apiKey,
    model,
    chatStrictSystemPrompt,
    strictPrompt,
    600,
    availableCounts
  )
  if (retry.ok) {
    const fallbackCandidate = buildFallbackChat(contextData, question)
    if (shouldOverrideNoData(retry.result.answer, fallbackCandidate.answer)) {
      return NextResponse.json(fallbackCandidate)
    }
    return NextResponse.json(retry.result)
  }

  const fallback = buildFallbackChat(contextData, question)
  return NextResponse.json(fallback)
}

function buildChatPrompt(
  contextData: ContextData,
  aiReport: AiReport | null,
  question: string,
  mode: "primary" | "strict"
) {
  const schema = [
    "answer: string",
    "sources_used: { restaurants:number, bars_and_clubs:number, cafes:number, supermarkets:number, transport:number, hotels:number, tourism:number }",
    "limits: string[] (solo si faltan datos relevantes)",
  ].join("\n")

  return [
    "Contexto JSON (datos reales OSM):",
    JSON.stringify(contextData),
    "",
    "Informe generado (si existe):",
    JSON.stringify(aiReport),
    "",
    "Pregunta del usuario:",
    question,
    "",
    "Esquema JSON requerido:",
    schema,
    "",
    "Reglas:",
    "- Responde solo en castellano de Espana, aunque el usuario pregunte en otro idioma.",
    "- Devuelve SOLO JSON valido (sin texto ni markdown).",
    "- Usa exclusivamente el contexto; no inventes ni salgas del radio.",
    "- Si existe algun POI relevante en el contexto, debes responder con esos datos.",
    "- Si falta informacion relevante: responde exactamente 'Con los datos disponibles no puedo confirmarlo' y agrega limits.",
    "- Si preguntan por mejores restaurantes: ordena por rating desc, si no hay rating usa distance_m asc.",
    mode === "strict"
      ? "- Si dudas, responde con la frase exacta y limits."
      : "",
  ].join("\n")
}

async function callGroqChat(
  apiUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  availableCounts: SourcesUsed
): Promise<{ ok: true; result: PlaceChatResponse } | { ok: false; error?: string }> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
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
  const parsed = safeJsonParse(text)
  if (!parsed) {
    return { ok: false, error: "Invalid JSON from model" }
  }
  const normalized = normalizeChatResponse(parsed, availableCounts)
  if (!normalized.ok) {
    return { ok: false, error: normalized.error }
  }
  return { ok: true, result: normalized.response }
}

function normalizeChatResponse(
  value: unknown,
  availableCounts: SourcesUsed
):
  | { ok: true; response: PlaceChatResponse }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Chat response is not an object" }
  }
  const raw = value as Record<string, unknown>
  const answer = typeof raw.answer === "string" ? raw.answer : null
  if (!answer) {
    return { ok: false, error: "answer missing" }
  }
  const sourcesRaw = raw.sources_used
  if (!isRecord(sourcesRaw)) {
    return { ok: false, error: "sources_used missing" }
  }
  const requiredKeys: Array<keyof SourcesUsed> = [
    "restaurants",
    "bars_and_clubs",
    "cafes",
    "supermarkets",
    "transport",
    "hotels",
    "tourism",
  ]
  for (const key of requiredKeys) {
    if (typeof sourcesRaw[key] !== "number") {
      return { ok: false, error: `sources_used.${key} missing` }
    }
  }

  const normalizedSources: SourcesUsed = {
    restaurants: clampCount(sourcesRaw.restaurants, availableCounts.restaurants),
    bars_and_clubs: clampCount(
      sourcesRaw.bars_and_clubs,
      availableCounts.bars_and_clubs
    ),
    cafes: clampCount(sourcesRaw.cafes, availableCounts.cafes),
    supermarkets: clampCount(
      sourcesRaw.supermarkets,
      availableCounts.supermarkets
    ),
    transport: clampCount(sourcesRaw.transport, availableCounts.transport),
    hotels: clampCount(sourcesRaw.hotels, availableCounts.hotels),
    tourism: clampCount(sourcesRaw.tourism, availableCounts.tourism),
  }

  const limitsRaw = raw.limits
  if (limitsRaw !== undefined && !Array.isArray(limitsRaw)) {
    return { ok: false, error: "limits must be array" }
  }
  const limits = Array.isArray(limitsRaw)
    ? limitsRaw.filter((item) => typeof item === "string")
    : undefined

  return {
    ok: true,
    response: {
      answer,
      sources_used: normalizedSources,
      limits: limits && limits.length > 0 ? limits : undefined,
    },
  }
}

function clampCount(value: unknown, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > max) return max
  return Math.floor(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function buildAvailableCounts(contextData: ContextData): SourcesUsed {
  return {
    restaurants: contextData.pois.restaurants.length,
    bars_and_clubs: contextData.pois.bars_and_clubs.length,
    cafes: contextData.pois.cafes.length,
    supermarkets: contextData.pois.supermarkets.length,
    transport: contextData.pois.transport.length,
    hotels: contextData.pois.hotels.length,
    tourism:
      contextData.pois.tourism.length +
      contextData.pois.museums.length +
      contextData.pois.viewpoints.length,
  }
}

function buildOverpassDownResponse(): PlaceChatResponse {
  return {
    answer:
      "Ahora mismo no puedo analizar este lugar porque los datos del mapa no estan disponibles.",
    sources_used: {
      restaurants: 0,
      bars_and_clubs: 0,
      cafes: 0,
      supermarkets: 0,
      transport: 0,
      hotels: 0,
      tourism: 0,
    },
    limits: ["Overpass no disponible"],
  }
}

function buildFallbackChat(contextData: ContextData, question: string): PlaceChatResponse {
  const NO_CONFIRM = "Con los datos disponibles no puedo confirmarlo"
  const lower = question.toLowerCase()
  const limits: string[] = []
  const sources: SourcesUsed = {
    restaurants: 0,
    bars_and_clubs: 0,
    cafes: 0,
    supermarkets: 0,
    transport: 0,
    hotels: 0,
    tourism: 0,
  }

  const wantsRestaurants = matchAny(lower, [
    "restaurante",
    "restaurantes",
    "comer",
    "cena",
    "almuerzo",
    "almorzar",
    "comida",
  ])
  const wantsBars = matchAny(lower, ["bar", "bares", "club", "discoteca"])
  const wantsCafes = matchAny(lower, ["cafe", "cafes", "cafeteria"])
  const wantsSupermarkets = matchAny(lower, ["supermercado", "supermercados"])
  const wantsTransport = matchAny(lower, [
    "bus",
    "autobus",
    "parada",
    "paradas",
    "transporte",
  ])
  const wantsHotels = matchAny(lower, ["hotel", "hoteles", "alojamiento"])
  const wantsTourism = matchAny(lower, [
    "turismo",
    "atraccion",
    "atracciones",
    "museo",
    "museos",
    "mirador",
    "miradores",
    "turistico",
  ])
  const wantsTapas = matchAny(lower, ["tapas", "tapear", "tapeo"])
  const wantsBest = matchAny(lower, [
    "mejor",
    "recomendado",
    "recomiendas",
    "cual elegir",
    "merece la pena",
    "donde ir",
  ])

  const wantsAny =
    wantsRestaurants ||
    wantsBars ||
    wantsCafes ||
    wantsSupermarkets ||
    wantsTransport ||
    wantsHotels ||
    wantsTourism

  if (!wantsAny) {
    return {
      answer: NO_CONFIRM,
      sources_used: sources,
      limits: ["La pregunta no se puede resolver con el contexto disponible."],
    }
  }

  const formatLine = (label: string, value: string) => `${label} ${value}`

  const buildRecommendation = (
    items: ContextPoiBase[],
    label: string,
    typeLabel: string,
    extraLimitations: string[] = []
  ): PlaceChatResponse | null => {
    if (items.length === 0) {
      return null
    }

    const sorted = sortByDistance(items)
    const primary = sorted[0]
    const alternatives = sorted.slice(1, 3)

    const reasons = [
      `Es el ${typeLabel} mas cercano dentro del radio.`,
      `Esta a ${primary.distance_m} m.`,
      alternatives[0]
        ? `Frente a ${alternatives[0].name} (${alternatives[0].distance_m} m), esta mas cerca.`
        : null,
    ].filter(Boolean) as string[]

    const altText =
      alternatives.length > 0
        ? alternatives
            .map((item) => `- ${item.name} (${item.distance_m} m)`)
            .join("\n")
        : "No hay alternativas cercanas adicionales en el contexto."

    const limitations = [
      ...extraLimitations,
      "No hay mas datos cualitativos (ambiente, calidad, precios) en el contexto.",
    ]

    return {
      answer: [
        formatLine("Recomendacion principal:", `${primary.name} (${primary.distance_m} m)`),
        "",
        "Por que:",
        ...reasons.map((reason) => `- ${reason}`),
        "",
        "Alternativas:",
        altText,
        "",
        "Limitaciones:",
        ...limitations.map((item) => `- ${item}`),
      ].join("\n"),
      sources_used: sources,
      limits: limitations,
    }
  }

  if (wantsRestaurants) {
    const list = wantsBest
      ? sortRestaurantsForBest(contextData.pois.restaurants)
      : sortByDistance(contextData.pois.restaurants)
    const top = list.slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay restaurantes en el contexto.")
    } else {
      sources.restaurants = top.length
      const response = buildRecommendation(
        top,
        "restaurante",
        "restaurante",
        []
      )
      if (response) return response
    }
  }

  if (wantsBars) {
    const top = sortByDistance(contextData.pois.bars_and_clubs).slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay bares o clubes en el contexto.")
    } else {
      sources.bars_and_clubs = top.length
      const extra = wantsTapas
        ? ["No hay datos especificos sobre tapas en el contexto."]
        : []
      const response = buildRecommendation(
        top,
        "bar",
        "bar o club",
        extra
      )
      if (response) return response
    }
  }

  if (wantsCafes) {
    const top = sortByDistance(contextData.pois.cafes).slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay cafes en el contexto.")
    } else {
      sources.cafes = top.length
      const response = buildRecommendation(top, "cafe", "cafe", [])
      if (response) return response
    }
  }

  if (wantsSupermarkets) {
    const top = sortByDistance(contextData.pois.supermarkets).slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay supermercados en el contexto.")
    } else {
      sources.supermarkets = top.length
      const response = buildRecommendation(
        top,
        "supermercado",
        "supermercado",
        []
      )
      if (response) return response
    }
  }

  if (wantsTransport) {
    const top = sortByDistance(contextData.pois.transport).slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay transporte en el contexto.")
    } else {
      sources.transport = top.length
      const response = buildRecommendation(
        top,
        "transporte",
        "parada o estacion",
        []
      )
      if (response) return response
    }
  }

  if (wantsHotels) {
    const top = sortByDistance(contextData.pois.hotels).slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay hoteles en el contexto.")
    } else {
      sources.hotels = top.length
      const response = buildRecommendation(top, "hotel", "hotel", [])
      if (response) return response
    }
  }

  if (wantsTourism) {
    const combined = [
      ...contextData.pois.tourism,
      ...contextData.pois.museums,
      ...contextData.pois.viewpoints,
    ]
    const top = sortByDistance(combined).slice(0, 3)
    if (top.length === 0) {
      limits.push("No hay datos de turismo en el contexto.")
    } else {
      sources.tourism = top.length
      const response = buildRecommendation(
        top,
        "lugar de interes",
        "lugar de interes",
        []
      )
      if (response) return response
    }
  }

  return {
    answer: NO_CONFIRM,
    sources_used: sources,
    limits: limits.length
      ? limits
      : ["Con el contexto disponible no puedo responder a la pregunta."],
  }
}

function shouldOverrideNoData(answer: string, fallbackAnswer: string) {
  const normalized = answer.trim()
  const fallback = fallbackAnswer.trim()
  return (
    normalized === "Con los datos disponibles no puedo confirmarlo" &&
    fallback !== "Con los datos disponibles no puedo confirmarlo"
  )
}

function sortByDistance<T extends ContextPoiBase>(items: T[]) {
  return [...items].sort((a, b) => a.distance_m - b.distance_m)
}

function sortRestaurantsForBest(items: Array<ContextPoiBase & { rating?: number | null }>) {
  return [...items].sort((a, b) => {
    const ratingA = typeof a.rating === "number" ? a.rating : -1
    const ratingB = typeof b.rating === "number" ? b.rating : -1
    if (ratingA === ratingB) {
      return a.distance_m - b.distance_m
    }
    return ratingB - ratingA
  })
}

function matchAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token))
}
