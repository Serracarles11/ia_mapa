import { NextResponse } from "next/server"

const DEFAULT_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const DEFAULT_MODEL = "llama-3.3-70b"

export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY
  const apiUrl = process.env.GROQ_API_URL || DEFAULT_API_URL
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    return NextResponse.json({ error: "Missing GROQ_API_KEY" }, { status: 500 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    lat: number
    lon: number
    radius_m: number
    is_touristic_area: boolean
    pois: {
      restaurants: Array<{ name: string; distance_m: number; type: "restaurant" | "fast_food" }>
      bars_and_clubs: Array<{ name: string; distance_m: number; type: "bar" | "club" }>
      cafes: Array<{ name: string; distance_m: number; type: "cafe" }>
      pharmacies: Array<{ name: string; distance_m: number; type: "pharmacy" }>
      hospitals: Array<{ name: string; distance_m: number; type: "hospital" }>
      schools: Array<{ name: string; distance_m: number; type: "school" }>
      supermarkets: Array<{ name: string; distance_m: number; type: "supermarket" }>
      transport: Array<{ name: string; distance_m: number; type: "bus_stop" }>
      hotels: Array<{ name: string; distance_m: number; type: "hotel" }>
      tourism: Array<{ name: string; distance_m: number; type: "attraction" }>
      museums: Array<{ name: string; distance_m: number; type: "museum" }>
      viewpoints: Array<{ name: string; distance_m: number; type: "viewpoint" }>
    }
  }>

  if (typeof body.lat !== "number" || typeof body.lon !== "number") {
    return NextResponse.json({ error: "Missing lat/lon" }, { status: 400 })
  }

  const safeInput: PromptInput = {
    lat: body.lat,
    lon: body.lon,
    radius_m: typeof body.radius_m === "number" ? body.radius_m : 1200,
    is_touristic_area: Boolean(body.is_touristic_area),
    pois: normalizePois(body.pois),
  }

  const prompt = buildPrompt(safeInput)

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
        { role: "user", content: prompt },
      ],
      max_tokens: 1400,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return NextResponse.json(
      { report: buildFallbackReport(`Groq request failed: ${errorText}`) },
      { status: 200 }
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data?.choices?.[0]?.message?.content || ""

  const report = safeJsonParse(text)
  if (!report) {
    return NextResponse.json(
      { report: buildFallbackReport("Invalid JSON from model") },
      { status: 200 }
    )
  }

  return NextResponse.json({ report })
}

type PromptInput = {
  lat: number
  lon: number
  radius_m: number
  is_touristic_area: boolean
  pois: PromptPois
}

type PromptPois = {
  restaurants: Array<{ name: string; distance_m: number; type: "restaurant" | "fast_food" }>
  bars_and_clubs: Array<{ name: string; distance_m: number; type: "bar" | "club" }>
  cafes: Array<{ name: string; distance_m: number; type: "cafe" }>
  pharmacies: Array<{ name: string; distance_m: number; type: "pharmacy" }>
  hospitals: Array<{ name: string; distance_m: number; type: "hospital" }>
  schools: Array<{ name: string; distance_m: number; type: "school" }>
  supermarkets: Array<{ name: string; distance_m: number; type: "supermarket" }>
  transport: Array<{ name: string; distance_m: number; type: "bus_stop" }>
  hotels: Array<{ name: string; distance_m: number; type: "hotel" }>
  tourism: Array<{ name: string; distance_m: number; type: "attraction" }>
  museums: Array<{ name: string; distance_m: number; type: "museum" }>
  viewpoints: Array<{ name: string; distance_m: number; type: "viewpoint" }>
}

const systemPrompt =
  "Eres un analista territorial y urbano experto. Usa EXCLUSIVAMENTE el JSON de contexto. Prohibido usar conocimiento externo o lugares fuera del radio. No inventes nombres ni atributos. Usa [] si una categoria no tiene datos. limited_info.is_limited solo puede ser true si TODAS las categorias de POIs estan vacias. Devuelve SOLO un JSON VALIDO (sin texto adicional ni bloque de codigo). Usa comillas dobles, sin comas finales y sin comentarios."

function buildPrompt(input: PromptInput) {
  const orderedContext = {
    center: { lat: input.lat, lon: input.lon },
    radius_m: input.radius_m,
    is_touristic_area: input.is_touristic_area,
    pois: input.pois,
  }

  const schemaDescription = [
    "place_name: string|null",
    "summary_general: string",
    "restaurants_nearby: Array<{name:string, distance_m:number}>",
    'ocio_inmediato: Array<{name:string, distance_m:number, type:"bar"|"cafe"|"fast_food"}>',
    "services: { pharmacies, hospitals, schools, bus_stops, supermarkets } (arrays de {name, distance_m})",
    "tourism: { hotels, museums, attractions, viewpoints } (arrays de {name, distance_m})",
    "limited_info: { is_limited:boolean, reason:string|null }",
  ].join("\n")

  return [
    "Contexto JSON (datos reales OSM):",
    JSON.stringify(orderedContext),
    "",
    "Esquema JSON requerido:",
    schemaDescription,
    "",
    "Reglas:",
    "- Si una categoria no tiene datos, usa [].",
    "- No inventes nombres ni atributos.",
    "- limited_info.is_limited solo es true si TODAS las categorias estan vacias.",
  ].join("\n")
}

function safeJsonParse(text: string) {
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

function normalizePois(input: PromptInput["pois"] | undefined): PromptPois {
  const empty: PromptPois = {
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

  if (!input) return empty

  const pick = <T extends { name: string; distance_m: number; type: string }>(
    items: T[] | undefined
  ) =>
    Array.isArray(items)
      ? items
          .filter((item) => item && typeof item.name === "string")
          .filter((item) => typeof item.distance_m === "number")
      : []

  return {
    restaurants: pick(input.restaurants),
    bars_and_clubs: pick(input.bars_and_clubs),
    cafes: pick(input.cafes),
    pharmacies: pick(input.pharmacies),
    hospitals: pick(input.hospitals),
    schools: pick(input.schools),
    supermarkets: pick(input.supermarkets),
    transport: pick(input.transport),
    hotels: pick(input.hotels),
    tourism: pick(input.tourism),
    museums: pick(input.museums),
    viewpoints: pick(input.viewpoints),
  }
}

function buildFallbackReport(reason: string) {
  return {
    place_name: null,
    summary_general:
      "No se pudo generar el informe completo. Se muestra un resumen limitado.",
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
