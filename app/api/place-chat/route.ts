import { NextResponse } from "next/server"

import { callLlm, type LlmMessage, type LlmTool } from "@/lib/llm"
import {
  buscarPOIsPorCategoria,
  type BuscarPOIsPorCategoriaResult,
} from "@/lib/tools/buscarPOIsPorCategoria"
import { type AiReport, type ContextData, type PoiItem } from "@/lib/types"

type PlaceChatRequest = {
  contextData?: ContextData | null
  aiReport?: AiReport | null
  question?: string
}

type SourcesUsed = {
  total_pois: number
  categories: Record<string, number>
  flood_risk: boolean
  flood_ok: boolean
  land_cover: boolean
  air_quality: boolean
  air_ok: boolean
}

type PlaceChatResponse = {
  answer: string
  limits?: string[]
  sources_used?: SourcesUsed
}

type PoiSummary = {
  counts: Record<string, number>
  total: number
  topByCategory: Record<string, PoiItem[]>
}

type IntentType =
  | "infraestructura"
  | "restauracion"
  | "comercio_especifico"
  | "riesgos"
  | "usos_urbanos"

type IntentResult = {
  intent: IntentType
  label: string
  singular: string
  tags: string[]
  requiresTool: boolean
}

type CategoryDef = {
  key: keyof ContextData["pois"]
  label: string
}

const CATEGORY_DEFS: CategoryDef[] = [
  { key: "restaurants", label: "restaurantes" },
  { key: "bars_and_clubs", label: "bares" },
  { key: "cafes", label: "cafes" },
  { key: "pharmacies", label: "farmacias" },
  { key: "hospitals", label: "hospitales" },
  { key: "schools", label: "colegios" },
  { key: "supermarkets", label: "supermercados" },
  { key: "transport", label: "transporte" },
  { key: "hotels", label: "hoteles" },
  { key: "tourism", label: "turismo" },
  { key: "museums", label: "museos" },
  { key: "viewpoints", label: "miradores" },
]

type TagRule = {
  intent: IntentType
  label: string
  singular: string
  keywords: string[]
  tags: string[]
}

const SPECIFIC_TAG_RULES: TagRule[] = [
  {
    intent: "comercio_especifico",
    label: "pastelerias",
    singular: "pasteleria",
    keywords: ["pasteleria", "reposteria", "confiteria", "dulceria"],
    tags: ["shop=bakery|confectionery"],
  },
  {
    intent: "comercio_especifico",
    label: "panaderias",
    singular: "panaderia",
    keywords: ["panaderia"],
    tags: ["shop=bakery"],
  },
  {
    intent: "comercio_especifico",
    label: "carnicerias",
    singular: "carniceria",
    keywords: ["carniceria"],
    tags: ["shop=butcher"],
  },
  {
    intent: "comercio_especifico",
    label: "pescaderias",
    singular: "pescaderia",
    keywords: ["pescaderia"],
    tags: ["shop=seafood"],
  },
  {
    intent: "comercio_especifico",
    label: "fruterias",
    singular: "fruteria",
    keywords: ["fruteria", "verduleria"],
    tags: ["shop=greengrocer"],
  },
  {
    intent: "comercio_especifico",
    label: "ferreterias",
    singular: "ferreteria",
    keywords: ["ferreteria"],
    tags: ["shop=hardware"],
  },
  {
    intent: "comercio_especifico",
    label: "librerias",
    singular: "libreria",
    keywords: ["libreria"],
    tags: ["shop=books"],
  },
  {
    intent: "comercio_especifico",
    label: "papelerias",
    singular: "papeleria",
    keywords: ["papeleria", "libreria tecnica"],
    tags: ["shop=stationery"],
  },
  {
    intent: "comercio_especifico",
    label: "floristerias",
    singular: "floristeria",
    keywords: ["floristeria", "floreria"],
    tags: ["shop=florist"],
  },
  {
    intent: "comercio_especifico",
    label: "zapaterias",
    singular: "zapateria",
    keywords: ["zapateria"],
    tags: ["shop=shoes"],
  },
  {
    intent: "comercio_especifico",
    label: "tiendas de ropa",
    singular: "tienda de ropa",
    keywords: ["ropa", "tienda de ropa", "moda"],
    tags: ["shop=clothes"],
  },
  {
    intent: "comercio_especifico",
    label: "peluquerias",
    singular: "peluqueria",
    keywords: ["peluqueria", "barberia"],
    tags: ["shop=hairdresser"],
  },
  {
    intent: "comercio_especifico",
    label: "estancos",
    singular: "estanco",
    keywords: ["estanco", "tabaco"],
    tags: ["shop=tobacco"],
  },
  {
    intent: "infraestructura",
    label: "gasolineras",
    singular: "gasolinera",
    keywords: ["gasolinera", "combustible"],
    tags: ["amenity=fuel"],
  },
  {
    intent: "infraestructura",
    label: "parkings",
    singular: "parking",
    keywords: ["parking", "aparcamiento"],
    tags: ["amenity=parking"],
  },
  {
    intent: "infraestructura",
    label: "bancos",
    singular: "banco",
    keywords: ["banco"],
    tags: ["amenity=bank"],
  },
  {
    intent: "infraestructura",
    label: "cajeros",
    singular: "cajero",
    keywords: ["cajero", "atm"],
    tags: ["amenity=atm"],
  },
  {
    intent: "infraestructura",
    label: "gimnasios",
    singular: "gimnasio",
    keywords: ["gimnasio", "fitness"],
    tags: ["leisure=fitness_centre"],
  },
  {
    intent: "restauracion",
    label: "pizzerias",
    singular: "pizzeria",
    keywords: ["pizzeria", "pizza"],
    tags: ["amenity=restaurant", "cuisine=pizza|italian"],
  },
  {
    intent: "restauracion",
    label: "sushi",
    singular: "sushi",
    keywords: ["sushi", "japones", "japonesa"],
    tags: ["amenity=restaurant", "cuisine=sushi|japanese"],
  },
  {
    intent: "restauracion",
    label: "tapas",
    singular: "tapas",
    keywords: ["tapas", "tapear", "tapeo"],
    tags: ["amenity=restaurant|bar", "cuisine=tapas|spanish"],
  },
  {
    intent: "restauracion",
    label: "marisquerias",
    singular: "marisqueria",
    keywords: ["marisqueria", "marisco"],
    tags: ["amenity=restaurant", "cuisine=seafood"],
  },
]

const VAGUE_HINTS = ["sigue igual", "sin cambios", "no ha cambiado"]

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PlaceChatRequest
  const question = typeof body.question === "string" ? body.question.trim() : ""

  if (!question) {
    return NextResponse.json(
      { ok: false, error: "Missing question" },
      { status: 400 }
    )
  }

  const contextData = body.contextData ?? null
  const aiReport = body.aiReport ?? null

  if (!contextData) {
    return NextResponse.json(buildNoContextResponse())
  }

  const response = await runChatAgent(contextData, aiReport, question)
  return NextResponse.json(response)
}

async function runChatAgent(
  context: ContextData,
  report: AiReport | null,
  question: string
): Promise<PlaceChatResponse> {
  const intent = detectIntent(question)
  const summary = buildPoiSummary(context)

  const tools = buildTools()
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(intent) },
    {
      role: "user",
      content: buildUserPrompt(context, report, question, summary, intent),
    },
  ]

  let toolResult: BuscarPOIsPorCategoriaResult | null = null

  for (let step = 0; step < 3; step += 1) {
    const response = await callLlm({
      messages,
      tools,
      temperature: 0.3,
    })

    if (!response) break

    const toolCalls = response.message.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      messages.push({ role: "assistant", content: null, tool_calls: toolCalls })

      for (const call of toolCalls) {
        if (call.name !== "buscarPOIsPorCategoria") continue
        const args = buildToolArgs(call.arguments, context, intent)
        toolResult = await buscarPOIsPorCategoria(
          args.lat,
          args.lon,
          args.radius_m,
          args.tags
        )

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        })
      }

      continue
    }

    const content = response.message.content
    if (typeof content === "string" && content.trim().length > 0) {
      if (intent.requiresTool && !toolResult) break
      const meta = buildResponseMeta(context, question, intent, toolResult)
      const fallback = buildFallbackChat(context, question, meta, intent, toolResult)
      return normalizeAnswer(content, fallback, meta)
    }
  }

  if (intent.requiresTool && !toolResult) {
    toolResult = await buscarPOIsPorCategoria(
      context.center.lat,
      context.center.lon,
      context.radius_m,
      intent.tags
    )
  }

  const meta = buildResponseMeta(context, question, intent, toolResult)
  return buildFallbackChat(context, question, meta, intent, toolResult)
}

function buildTools(): LlmTool[] {
  return [
    {
      name: "buscarPOIsPorCategoria",
      description:
        "Busca POIs en Overpass para una categoria especifica usando tags OSM.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
          radius_m: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["lat", "lon", "radius_m", "tags"],
      },
    },
  ]
}

function buildToolArgs(
  args: Record<string, unknown>,
  context: ContextData,
  intent: IntentResult
) {
  const lat = getNumber(args.lat) ?? context.center.lat
  const lon = getNumber(args.lon) ?? context.center.lon
  const radius_m = getNumber(args.radius_m) ?? context.radius_m
  const tags = extractTags(args.tags, intent.tags)
  return { lat, lon, radius_m, tags }
}

function extractTags(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const tags = value.map((item) => String(item).trim()).filter(Boolean)
  return tags.length > 0 ? tags : fallback
}

function buildSystemPrompt(intent: IntentResult) {
  return [
    "Eres un asistente geoespacial con herramientas.",
    "Antes de responder debes seguir este flujo:",
    "1) Analizar la pregunta e intencion.",
    "2) Decidir si necesitas datos nuevos.",
    "3) Si requiere busqueda, llamar a buscarPOIsPorCategoria.",
    "4) Razonar con los datos y responder.",
    "Responde SIEMPRE en castellano y no inventes datos.",
    "Aporta opinion profesional y recomendaciones claras basadas en los datos.",
    "Si faltan datos, indicalo en limitaciones sin frases de incapacidad.",
    "Si requiere_busqueda es true y necesitas mas datos, usa la herramienta.",
    "Devuelve texto normal con estos encabezados exactos:",
    "Recomendacion principal:",
    "Por que:",
    "Alternativas:",
    "Limitaciones:",
    "Intent detectado: " + intent.intent,
    "requiere_busqueda: " + String(intent.requiresTool),
    "tags_sugeridos: " + (intent.tags.length > 0 ? intent.tags.join(", ") : "ninguno"),
  ].join("\n")
}

function buildUserPrompt(
  context: ContextData,
  report: AiReport | null,
  question: string,
  summary: PoiSummary,
  intent: IntentResult
) {
  const summaryLine = buildSummaryLine(summary)
  const topLines = buildTopLines(summary)
  const flood = context.flood_risk
  const landCover = context.land_cover
  const air = context.air_quality

  const floodLine = flood
    ? `Riesgo inundacion: ${flood.risk_level} (${flood.details})`
    : "Riesgo inundacion: sin datos"
  const landLine = landCover
    ? `Uso del suelo CLC: ${landCover.label} (codigo ${landCover.code})`
    : "Uso del suelo CLC: sin datos"
  const airLine = air
    ? `Calidad del aire: ${air.details}`
    : "Calidad del aire: sin datos"

  const intentLine = `Intent: ${intent.intent} | Categoria: ${intent.label} | Tags: ${intent.tags.join(", ") || "ninguno"}`

  return [
    "Resumen numerico de POIs:",
    summaryLine,
    "",
    "Top 3 por categoria:",
    topLines.length > 0 ? topLines.join("\n") : "Sin POIs",
    "",
    floodLine,
    landLine,
    airLine,
    intentLine,
    "",
    "Contexto JSON:",
    JSON.stringify(context),
    "",
    "Informe IA (si existe):",
    JSON.stringify(report),
    "",
    "Pregunta del usuario:",
    question,
  ].join("\n")
}

function buildResponseMeta(
  context: ContextData,
  question: string,
  intent: IntentResult,
  dynamicResult: BuscarPOIsPorCategoriaResult | null
) {
  const summary = buildPoiSummary(context)
  const usesPois =
    intent.intent === "infraestructura" ||
    intent.intent === "restauracion" ||
    intent.intent === "comercio_especifico"
  const limits = buildLimitations(context, question, usesPois, intent, dynamicResult)
  const sourcesUsed = buildSourcesUsed(summary, context, intent, dynamicResult)

  return { summary, limits, sourcesUsed }
}

function normalizeAnswer(
  raw: string,
  fallback: PlaceChatResponse,
  meta: ReturnType<typeof buildResponseMeta>
): PlaceChatResponse {
  const content = raw.trim()
  const lower = content.toLowerCase()
  const isVague = VAGUE_HINTS.some((hint) => lower.includes(hint))
  const looksJson = content.startsWith("{")

  if (isVague || looksJson || content.length < 20) {
    return fallback
  }

  return {
    answer: content,
    limits: meta.limits,
    sources_used: meta.sourcesUsed,
  }
}

function buildNoContextResponse(): PlaceChatResponse {
  return {
    answer:
      "Recomendacion principal: No hay datos del lugar cargados.\n" +
      "Por que: Necesito un punto seleccionado en el mapa para responder.\n" +
      "Alternativas: Selecciona un punto o busca una direccion.\n" +
      "Limitaciones: Sin contexto geoespacial disponible.",
    limits: ["Sin contexto geoespacial"],
    sources_used: {
      total_pois: 0,
      categories: {},
      flood_risk: false,
      flood_ok: false,
      land_cover: false,
      air_quality: false,
      air_ok: false,
    },
  }
}

function buildFallbackChat(
  context: ContextData,
  question: string,
  meta: ReturnType<typeof buildResponseMeta>,
  intent: IntentResult,
  dynamicResult: BuscarPOIsPorCategoriaResult | null
): PlaceChatResponse {
  if (intent.intent === "riesgos") {
    return buildFloodAnswer(context, meta)
  }

  if (intent.intent === "usos_urbanos") {
    return buildLandUseAnswer(context, meta)
  }

  if (intent.requiresTool) {
    return buildDynamicAnswer(intent, dynamicResult, meta)
  }

  const lower = normalizeText(question)
  const selection = selectCandidates(context, lower, intent)
  const items = selection.items

  if (items.length === 0) {
    return {
      answer: buildNoDataAnswer(selection.label, meta.limits),
      limits: meta.limits,
      sources_used: meta.sourcesUsed,
    }
  }

  const sorted = sortByDistance(items)
  const primary = sorted[0]
  const alternatives = sorted.slice(1, 3)
  const wantsClosest = isClosestQuestion(lower)
  const wantsBest = isBestQuestion(lower)

  const reasons: string[] = []
  if (wantsClosest) {
    reasons.push("- Es el punto mas cercano dentro del radio.")
  } else {
    reasons.push(`- Es el ${selection.label} mas cercano dentro del radio.`)
  }
  if (wantsBest) {
    reasons.push("- Prioriza cercania y tipo segun el contexto disponible.")
  }

  const altLines = alternatives.length
    ? alternatives.map((item) => `- ${item.name} (${item.distance_m} m)`).join("\n")
    : "- No hay alternativas cercanas adicionales."

  const answer = [
    `Recomendacion principal: ${primary.name} (${primary.distance_m} m)`,
    "Por que:",
    ...reasons,
    "Alternativas:",
    altLines,
    "Limitaciones:",
    ...meta.limits.map((item) => `- ${item}`),
  ].join("\n")

  return {
    answer,
    limits: meta.limits,
    sources_used: meta.sourcesUsed,
  }
}

function buildDynamicAnswer(
  intent: IntentResult,
  result: BuscarPOIsPorCategoriaResult | null,
  meta: ReturnType<typeof buildResponseMeta>
): PlaceChatResponse {
  if (!result || !result.ok) {
    const answer = [
      `Recomendacion principal: No hay datos suficientes sobre ${intent.label}.`,
      "Por que:",
      "- No se pudo consultar Overpass para la categoria solicitada.",
      "Alternativas:",
      "- Prueba con otra categoria o aumenta el radio.",
      "Limitaciones:",
      ...meta.limits.map((item) => `- ${item}`),
    ].join("\n")

    return {
      answer,
      limits: meta.limits,
      sources_used: meta.sourcesUsed,
    }
  }

  if (result.pois.length === 0) {
    const answer = [
      `Recomendacion principal: No se detectan ${intent.label} en el radio.`,
      "Por que:",
      `- Segun OpenStreetMap, hay 0 resultados para ${intent.label} dentro del radio.`,
      "Alternativas:",
      "- Prueba con un radio mayor o revisa otra categoria.",
      "Limitaciones:",
      ...meta.limits.map((item) => `- ${item}`),
    ].join("\n")

    return {
      answer,
      limits: meta.limits,
      sources_used: meta.sourcesUsed,
    }
  }

  const sorted = sortByDistance(result.pois)
  const primary = sorted[0]
  const alternatives = sorted.slice(1, 3)
  const altLines = alternatives.length
    ? alternatives.map((item) => `- ${item.name} (${item.distance_m} m)`).join("\n")
    : "- No hay alternativas cercanas adicionales."

  const answer = [
    `Recomendacion principal: ${primary.name} (${primary.distance_m} m)`,
    "Por que:",
    `- Segun OpenStreetMap, dentro de ${result.radius_m} m hay ${result.pois.length} ${intent.label}.`,
    "- Es la opcion mas cercana dentro del radio.",
    "Alternativas:",
    altLines,
    "Limitaciones:",
    ...meta.limits.map((item) => `- ${item}`),
  ].join("\n")

  return {
    answer,
    limits: meta.limits,
    sources_used: meta.sourcesUsed,
  }
}

function buildFloodAnswer(
  context: ContextData,
  meta: ReturnType<typeof buildResponseMeta>
): PlaceChatResponse {
  const flood = context.flood_risk
  const riskLabel = flood ? flood.risk_level : "desconocido"
  const riskSource = flood?.source ?? "sin datos"
  const riskDetails = flood?.details ?? "Servicio no disponible"

  const reasons = [
    `- Estado actual: riesgo ${riskLabel}.`,
    `- Detalle: ${riskDetails}`,
  ]

  const alternatives = [
    "- Compara con otros puntos cercanos si necesitas mas seguridad.",
  ]

  const answer = [
    `Recomendacion principal: Riesgo ${riskLabel} de inundacion (fuente: ${riskSource}).`,
    "Por que:",
    ...reasons,
    "Alternativas:",
    alternatives.join("\n"),
    "Limitaciones:",
    ...meta.limits.map((item) => `- ${item}`),
  ].join("\n")

  return {
    answer,
    limits: meta.limits,
    sources_used: meta.sourcesUsed,
  }
}

function buildLandUseAnswer(
  context: ContextData,
  meta: ReturnType<typeof buildResponseMeta>
): PlaceChatResponse {
  const land = context.land_cover

  if (!land) {
    const answer = [
      "Recomendacion principal: No hay datos de uso del suelo disponibles.",
      "Por que:",
      "- No se pudo obtener CLC 2018 para este punto.",
      "Alternativas:",
      "- Prueba con otro punto o revisa capas en el mapa.",
      "Limitaciones:",
      ...meta.limits.map((item) => `- ${item}`),
    ].join("\n")

    return {
      answer,
      limits: meta.limits,
      sources_used: meta.sourcesUsed,
    }
  }

  const answer = [
    `Recomendacion principal: Uso del suelo ${land.label}.`,
    "Por que:",
    `- Copernicus CLC 2018 indica codigo ${land.code} en el punto.`,
    "Alternativas:",
    "- Contrasta con otros puntos cercanos si necesitas mas detalle.",
    "Limitaciones:",
    ...meta.limits.map((item) => `- ${item}`),
  ].join("\n")

  return {
    answer,
    limits: meta.limits,
    sources_used: meta.sourcesUsed,
  }
}

function buildNoDataAnswer(label: string, limits: string[]) {
  return [
    "Recomendacion principal: No hay opciones suficientes en el radio.",
    "Por que:",
    `- No hay opciones de ${label} disponibles en el contexto.`,
    "Alternativas:",
    "- Prueba con un radio mayor o pregunta por otra categoria.",
    "Limitaciones:",
    ...limits.map((item) => `- ${item}`),
  ].join("\n")
}

function detectIntent(question: string): IntentResult {
  const normalized = normalizeText(question)

  const rule = SPECIFIC_TAG_RULES.find((item) =>
    item.keywords.some((keyword) => normalized.includes(keyword))
  )

  if (rule) {
    return {
      intent: rule.intent,
      label: rule.label,
      singular: rule.singular,
      tags: rule.tags,
      requiresTool: true,
    }
  }

  if (isRiskQuestion(normalized)) {
    return {
      intent: "riesgos",
      label: "riesgos",
      singular: "riesgo",
      tags: [],
      requiresTool: false,
    }
  }

  if (isLandUseQuestion(normalized)) {
    return {
      intent: "usos_urbanos",
      label: "usos del suelo",
      singular: "uso del suelo",
      tags: [],
      requiresTool: false,
    }
  }

  if (isRestauracionQuestion(normalized)) {
    return {
      intent: "restauracion",
      label: "restaurante",
      singular: "restaurante",
      tags: [],
      requiresTool: false,
    }
  }

  if (isInfraQuestion(normalized)) {
    return {
      intent: "infraestructura",
      label: "infraestructura",
      singular: "infraestructura",
      tags: [],
      requiresTool: false,
    }
  }

  return {
    intent: "infraestructura",
    label: "infraestructura",
    singular: "infraestructura",
    tags: [],
    requiresTool: false,
  }
}

function selectCandidates(
  context: ContextData,
  lower: string,
  intent: IntentResult
) {
  if (intent.intent === "restauracion" && isTapasQuestion(lower)) {
    return pickFirstAvailable(context, [
      { key: "bars_and_clubs", label: "bar" },
      { key: "restaurants", label: "restaurante" },
    ])
  }

  if (intent.intent === "restauracion" && isEatQuestion(lower)) {
    return pickFirstAvailable(context, [
      { key: "restaurants", label: "restaurante" },
      { key: "cafes", label: "cafe" },
      { key: "bars_and_clubs", label: "bar" },
    ])
  }

  if (matchAny(lower, ["bar", "bares", "pub", "copas", "club"])) {
    return { label: "bar", items: context.pois.bars_and_clubs }
  }

  if (matchAny(lower, ["cafe", "cafes", "cafeteria"])) {
    return { label: "cafe", items: context.pois.cafes }
  }

  if (matchAny(lower, ["farmacia", "farmacias"])) {
    return { label: "farmacia", items: context.pois.pharmacies }
  }

  if (matchAny(lower, ["hospital", "clinica", "medico"])) {
    return { label: "hospital", items: context.pois.hospitals }
  }

  if (matchAny(lower, ["colegio", "escuela", "instituto"])) {
    return { label: "colegio", items: context.pois.schools }
  }

  if (matchAny(lower, ["supermercado", "supermercados"])) {
    return { label: "supermercado", items: context.pois.supermarkets }
  }

  if (matchAny(lower, ["bus", "autobus", "parada", "transporte"])) {
    return { label: "transporte", items: context.pois.transport }
  }

  if (matchAny(lower, ["hotel", "alojamiento"])) {
    return { label: "hotel", items: context.pois.hotels }
  }

  if (matchAny(lower, ["turismo", "atraccion", "museo", "mirador"])) {
    return { label: "atraccion turistica", items: getTourismItems(context) }
  }

  if (isClosestQuestion(lower)) {
    return { label: "POI", items: getAllPois(context) }
  }

  if (intent.intent === "infraestructura") {
    return pickFirstAvailable(context, [
      { key: "transport", label: "transporte" },
      { key: "pharmacies", label: "farmacia" },
      { key: "hospitals", label: "hospital" },
      { key: "schools", label: "colegio" },
    ])
  }

  return { label: "restaurante", items: context.pois.restaurants }
}

function pickFirstAvailable(
  context: ContextData,
  options: Array<{ key: keyof ContextData["pois"]; label: string }>
) {
  for (const option of options) {
    const items = context.pois[option.key]
    if (items.length > 0) {
      return { label: option.label, items }
    }
  }
  return { label: options[0].label, items: [] as PoiItem[] }
}

function getAllPois(context: ContextData): PoiItem[] {
  const p = context.pois
  return sortByDistance([
    ...p.restaurants,
    ...p.bars_and_clubs,
    ...p.cafes,
    ...p.pharmacies,
    ...p.hospitals,
    ...p.schools,
    ...p.supermarkets,
    ...p.transport,
    ...p.hotels,
    ...p.tourism,
    ...p.museums,
    ...p.viewpoints,
  ])
}

function getTourismItems(context: ContextData): PoiItem[] {
  return sortByDistance([
    ...context.pois.tourism,
    ...context.pois.museums,
    ...context.pois.viewpoints,
  ])
}

function buildPoiSummary(context: ContextData): PoiSummary {
  const counts: Record<string, number> = {}
  const topByCategory: Record<string, PoiItem[]> = {}
  let total = 0

  for (const def of CATEGORY_DEFS) {
    const items = context.pois[def.key]
    counts[def.label] = items.length
    total += items.length
    topByCategory[def.label] = items.slice(0, 3)
  }

  return { counts, total, topByCategory }
}

function buildSummaryLine(summary: PoiSummary) {
  const entries = Object.entries(summary.counts).map(
    ([label, count]) => `${label}: ${count}`
  )
  return entries.length > 0 ? entries.join(", ") : "Sin POIs"
}

function buildTopLines(summary: PoiSummary) {
  return Object.entries(summary.topByCategory)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => {
      const top = items
        .map((item) => `${item.name} (${item.distance_m} m)`)
        .join(", ")
      return `${label}: ${top}`
    })
}

function buildSourcesUsed(
  summary: PoiSummary,
  context: ContextData,
  intent: IntentResult,
  dynamicResult: BuscarPOIsPorCategoriaResult | null
): SourcesUsed {
  const categories = { ...summary.counts }
  const airStatus = context.risks?.air?.status ?? "DOWN"
  const airOk = context.air_quality?.ok ?? false

  if (intent.requiresTool && dynamicResult?.ok) {
    categories[intent.label] = dynamicResult.pois.length
  }

  return {
    total_pois: summary.total + (dynamicResult?.ok ? dynamicResult.pois.length : 0),
    categories,
    flood_risk: Boolean(context.flood_risk),
    flood_ok: context.flood_risk?.ok ?? false,
    land_cover: Boolean(context.land_cover),
    air_quality: airStatus !== "DOWN",
    air_ok: airOk && airStatus !== "VISUAL_ONLY",
  }
}

function buildLimitations(
  context: ContextData,
  question: string,
  usesPois: boolean,
  intent: IntentResult,
  dynamicResult: BuscarPOIsPorCategoriaResult | null
) {
  const limits: string[] = []

  if (!context.land_cover) {
    limits.push("Sin datos de uso del suelo CLC 2018.")
  }
  if (!context.flood_risk || !context.flood_risk.ok) {
    limits.push("Sin datos de riesgo de inundacion del WMS oficial.")
  }
  if (!context.air_quality || !context.air_quality.ok) {
    limits.push("Sin datos CAMS de calidad del aire.")
  }
  if (context.risks?.air?.status === "VISUAL_ONLY") {
    limits.push("Calidad del aire disponible solo como capa visual.")
  }
  if (!hasPois(context)) {
    limits.push("Sin POIs disponibles dentro del radio.")
  }
  if (usesPois) {
    limits.push("No hay datos cualitativos (precios, horarios, valoraciones).")
  }
  if (isTapasQuestion(normalizeText(question))) {
    limits.push("No hay datos especificos sobre tapas en el contexto.")
  }
  if (intent.requiresTool) {
    if (!dynamicResult || !dynamicResult.ok) {
      limits.push("No se pudo consultar la categoria solicitada en Overpass.")
    } else if (dynamicResult.pois.length === 0) {
      limits.push("No hay resultados para la categoria solicitada en el radio.")
    }
  }

  return dedupe(limits)
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

function normalizeText(value: string) {
  return stripDiacritics(value).toLowerCase()
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function isRiskQuestion(lower: string) {
  return matchAny(lower, ["inundacion", "inundable", "riesgo", "inundaciones"])
}

function isLandUseQuestion(lower: string) {
  return matchAny(lower, [
    "uso del suelo",
    "usos urbanos",
    "urbanismo",
    "zonificacion",
    "planeamiento",
    "suelo",
  ])
}

function isRestauracionQuestion(lower: string) {
  return matchAny(lower, [
    "restaurante",
    "restaurantes",
    "bar",
    "bares",
    "cafe",
    "cafes",
    "comer",
    "cena",
    "almuerzo",
    "tapas",
  ])
}

function isInfraQuestion(lower: string) {
  return matchAny(lower, [
    "hospital",
    "clinica",
    "colegio",
    "escuela",
    "farmacia",
    "transporte",
    "bus",
    "parada",
    "metro",
  ])
}

function isTapasQuestion(lower: string) {
  return matchAny(lower, ["tapas", "tapear", "tapeo"])
}

function isEatQuestion(lower: string) {
  return matchAny(lower, [
    "comer",
    "restaurante",
    "restaurantes",
    "cena",
    "almuerzo",
    "comida",
  ])
}

function isClosestQuestion(lower: string) {
  return matchAny(lower, ["mas cerca", "mas cercano", "mas proximo", "mas proxima"])
}

function isBestQuestion(lower: string) {
  return matchAny(lower, [
    "mejor",
    "recomendado",
    "recomiendas",
    "cual elegir",
    "merece la pena",
    "donde ir",
  ])
}

function sortByDistance<T extends { distance_m: number }>(items: T[]) {
  return [...items].sort((a, b) => a.distance_m - b.distance_m)
}

function matchAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token))
}

function dedupe(list: string[]) {
  const seen = new Set<string>()
  const output: string[] = []
  for (const item of list) {
    if (seen.has(item)) continue
    seen.add(item)
    output.push(item)
  }
  return output
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
