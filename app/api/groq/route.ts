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

  const primaryPrompt = buildPrompt(safeInput, "primary")
  const primary = await callGroq(apiUrl, apiKey, model, systemPrompt, primaryPrompt, 1400)
  if (primary.ok) {
    const report = safeJsonParse(primary.text)
    if (report) {
      return NextResponse.json({ report })
    }
  }

  const reducedInput = {
    ...safeInput,
    pois: trimPois(safeInput.pois, 6),
  }
  const fallbackPrompt = buildPrompt(reducedInput, "minimal")
  const fallback = await callGroq(apiUrl, apiKey, model, systemPrompt, fallbackPrompt, 800)
  if (fallback.ok) {
    const report = safeJsonParse(fallback.text)
    if (report) {
      return NextResponse.json({ report })
    }
  }

  const errorText = primary.error || fallback.error || "Groq no disponible"
  return NextResponse.json(
    { report: buildFallbackReport(errorText) },
    { status: 200 }
  )
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
  "Eres un analista territorial. Responde SOLO con JSON valido. No inventes datos ni uses fuentes externas. Usa [] si una categoria no tiene datos. limited_info.is_limited solo es true si TODAS las categorias estan vacias."

function buildPrompt(input: PromptInput, mode: "primary" | "minimal") {
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
    mode === "minimal"
      ? "- Si hay dudas, devuelve arrays vacios y limited_info.is_limited true."
      : "",
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

async function callGroq(
  apiUrl: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  maxTokens: number
) {
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
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
      return { ok: false, error: "Empty content" }
    }
    if (/json_validate_failed|failed_generation/i.test(text)) {
      return { ok: false, error: "Model JSON validation failed" }
    }
    return { ok: true, text }
  } catch (error) {
    return { ok: false, error: String(error) }
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

function trimPois(pois: PromptPois, limit: number): PromptPois {
  const pick = <T>(items: T[]) => items.slice(0, limit)
  return {
    restaurants: pick(pois.restaurants),
    bars_and_clubs: pick(pois.bars_and_clubs),
    cafes: pick(pois.cafes),
    pharmacies: pick(pois.pharmacies),
    hospitals: pick(pois.hospitals),
    schools: pick(pois.schools),
    supermarkets: pick(pois.supermarkets),
    transport: pick(pois.transport),
    hotels: pick(pois.hotels),
    tourism: pick(pois.tourism),
    museums: pick(pois.museums),
    viewpoints: pick(pois.viewpoints),
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
