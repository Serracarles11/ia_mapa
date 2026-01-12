import "server-only"

import { callLlm, safeJsonParse, type LlmMessage, type LlmTool } from "@/lib/llm"
import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas"
import { capasUrbanismo, type CapasUrbanismoResult } from "@/lib/tools/capasUrbanismo"
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion"
import { type AiReport, type ContextData, type FloodRiskInfo, type LandCoverInfo } from "@/lib/types"

type ToolCache = {
  capasUrbanismo?: CapasUrbanismoResult | null
  riesgoInundacion?: FloodRiskInfo | null
}

type AgentResult = {
  report: AiReport | null
  landCover: LandCoverInfo | null
  floodRisk: FloodRiskInfo | null
  warnings: string[]
}

export async function runAgent(
  baseContext: ContextData,
  placeName: string | null,
  toolCache: ToolCache = {}
): Promise<AgentResult> {
  const tools = buildTools()
  const warnings: string[] = []

  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "user",
      content: buildUserPrompt(baseContext, placeName),
    },
  ]

  let landCover: LandCoverInfo | null = baseContext.land_cover
  let floodRisk: FloodRiskInfo | null = baseContext.flood_risk

  for (let step = 0; step < 4; step += 1) {
    const response = await callLlm({
      messages,
      tools,
      temperature: 0.2,
      responseFormat: "json_object",
    })

    if (!response) {
      warnings.push("IA no disponible")
      return { report: null, landCover, floodRisk, warnings }
    }

    const toolCalls = response.message.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: toolCalls,
      })

      for (const call of toolCalls) {
        const toolResult = await runTool(call.name, call.arguments, toolCache)
        if (call.name === "capasUrbanismo") {
          const result = toolResult as CapasUrbanismoResult | null
          landCover = result?.land_cover ?? landCover
        }
        if (call.name === "riesgoInundacion") {
          const result = toolResult as FloodRiskInfo | null
          floodRisk = result
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult ?? null),
        })
      }

      continue
    }

    const content = response.message.content ?? ""
    const parsed = safeJsonParse(content)
    const report = parsed ? normalizeReport(parsed) : null
    if (!report) {
      warnings.push("Respuesta IA invalida")
      return { report: null, landCover, floodRisk, warnings }
    }

    return { report, landCover, floodRisk, warnings }
  }

  warnings.push("IA sin respuesta final")
  return { report: null, landCover, floodRisk, warnings }
}

function buildTools(): LlmTool[] {
  return [
    {
      name: "buscarCoordenadas",
      description:
        "Geocodifica una direccion usando Nominatim (OpenStreetMap).",
      parameters: {
        type: "object",
        properties: {
          direccion: { type: "string" },
        },
        required: ["direccion"],
      },
    },
    {
      name: "capasUrbanismo",
      description:
        "Consulta Copernicus CLC 2018 e IGN para conocer uso del suelo y capas cartograficas en un punto.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
        },
        required: ["lat", "lon"],
      },
    },
    {
      name: "riesgoInundacion",
      description:
        "Consulta WMS oficial de zonas inundables para saber si el punto esta afectado.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
        },
        required: ["lat", "lon"],
      },
    },
  ]
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  cache: ToolCache
) {
  if (name === "buscarCoordenadas") {
    const direccion =
      typeof args.direccion === "string" ? args.direccion.trim() : ""
    if (!direccion) return null
    return buscarCoordenadas(direccion)
  }

  const lat = typeof args.lat === "number" ? args.lat : null
  const lon = typeof args.lon === "number" ? args.lon : null

  if (lat == null || lon == null) return null

  if (name === "capasUrbanismo") {
    if (cache.capasUrbanismo === undefined) {
      cache.capasUrbanismo = await capasUrbanismo(lat, lon)
    }
    return cache.capasUrbanismo
  }

  if (name === "riesgoInundacion") {
    if (cache.riesgoInundacion === undefined) {
      cache.riesgoInundacion = await riesgoInundacion(lat, lon)
    }
    return cache.riesgoInundacion
  }

  return null
}

function buildSystemPrompt() {
  return [
    "Eres un analista geoespacial. Responde SIEMPRE en castellano.",
    "Antes de redactar el informe debes llamar SIEMPRE a las herramientas capasUrbanismo y riesgoInundacion.",
    "Usa SOLO el contexto y las herramientas. No inventes datos.",
    "Devuelve SOLO un JSON valido con este esquema:",
    "{",
    '  "descripcion_zona": string,',
    '  "infraestructura_cercana": string,',
    '  "riesgos": string,',
    '  "usos_urbanos": string,',
    '  "recomendacion_final": string,',
    '  "fuentes": string[],',
    '  "limitaciones": string[]',
    "}",
    "Incluye limitaciones reales si faltan datos.",
  ].join("\n")
}

function buildUserPrompt(context: ContextData, placeName: string | null) {
  return [
    "Contexto JSON (datos reales):",
    JSON.stringify(context),
    "",
    `Lugar: ${placeName ?? "Sin nombre"}`,
  ].join("\n")
}

function normalizeReport(value: unknown): AiReport | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>

  const descripcion = getString(raw.descripcion_zona)
  const infraestructura = getString(raw.infraestructura_cercana)
  const riesgos = getString(raw.riesgos)
  const usos = getString(raw.usos_urbanos)
  const recomendacion = getString(raw.recomendacion_final)
  const fuentes = getStringArray(raw.fuentes)
  const limitaciones = getStringArray(raw.limitaciones)

  if (!descripcion || !infraestructura || !riesgos || !usos || !recomendacion) {
    return null
  }

  return {
    descripcion_zona: descripcion,
    infraestructura_cercana: infraestructura,
    riesgos,
    usos_urbanos: usos,
    recomendacion_final: recomendacion,
    fuentes,
    limitaciones,
  }
}

function getString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === "string" && item.trim().length > 0)
}
