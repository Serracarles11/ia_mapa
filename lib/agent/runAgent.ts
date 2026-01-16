import "server-only"

import { z } from "zod"

import { callLlm, safeJsonParse, type LlmMessage, type LlmTool } from "@/lib/llm"
import { buscarCoordenadas } from "@/lib/tools/buscarCoordenadas"
import { capasUrbanismo, type CapasUrbanismoResult } from "@/lib/tools/capasUrbanismo"
import { aireContaminacion } from "@/lib/tools/aireContaminacion"
import { riesgoInundacion } from "@/lib/tools/riesgoInundacion"
import {
  type AiReport,
  type AirQualityInfo,
  type ContextData,
  type FloodRiskInfo,
  type LandCoverInfo,
} from "@/lib/types"

type ToolCache = {
  capasUrbanismo?: CapasUrbanismoResult | null
  riesgoInundacion?: FloodRiskInfo | null
  aireContaminacion?: AirQualityInfo | null
}

type AgentResult = {
  report: AiReport | null
  landCover: LandCoverInfo | null
  floodRisk: FloodRiskInfo | null
  airQuality: AirQualityInfo | null
  warnings: string[]
}

const reportSchema = z
  .object({
    descripcion_zona: z.string().min(1),
    infraestructura_cercana: z.string().min(1),
    riesgos: z.string().min(1),
    usos_urbanos: z.string().min(1),
    recomendacion_final: z.string().min(1),
    fuentes: z.array(z.string()),
    limitaciones: z.array(z.string()),
  })
  .strict()

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
  let airQuality: AirQualityInfo | null = baseContext.air_quality

  for (let step = 0; step < 4; step += 1) {
    const response = await callLlm({
      messages,
      tools,
      temperature: 0.3,
      responseFormat: "json_object",
    })

    if (!response) {
      warnings.push("IA no disponible")
      return { report: null, landCover, floodRisk, airQuality, warnings }
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
        if (call.name === "aireContaminacion") {
          const result = toolResult as AirQualityInfo | null
          airQuality = result
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
    if (!content.trim()) {
      warnings.push("Respuesta IA vacia")
      messages.push({
        role: "user",
        content:
          "Tu respuesta estaba vacia. Devuelve SOLO el JSON del esquema, sin texto adicional.",
      })
      continue
    }

    const parsed = safeJsonParse(content)
    const report = parsed ? normalizeReport(parsed) : null
    if (!report) {
      warnings.push("Respuesta IA invalida")
      messages.push({
        role: "user",
        content:
          "Tu respuesta no cumple el esquema. Devuelve SOLO el JSON valido del informe.",
      })
      continue
    }

    return { report, landCover, floodRisk, airQuality, warnings }
  }

  warnings.push("IA sin respuesta final")
  return { report: null, landCover, floodRisk, airQuality, warnings }
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
    {
      name: "aireContaminacion",
      description:
        "Consulta CAMS (Copernicus Atmosphere) para conocer contaminacion/aire en el punto.",
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

  if (name === "aireContaminacion") {
    if (cache.aireContaminacion === undefined) {
      cache.aireContaminacion = await aireContaminacion(lat, lon)
    }
    return cache.aireContaminacion
  }

  return null
}

function buildSystemPrompt() {
  return [
    "Eres un analista geoespacial. Responde SIEMPRE en castellano.",
    "Usa SOLO el contexto y las herramientas si necesitas mas datos. No inventes.",
    "Toda afirmacion debe estar respaldada por datos del contexto.",
    "Si faltan datos, indicalo en limitaciones sin frases de incapacidad.",
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
    "Incluye SOLO fuentes reales de context.sources y SOLO limitaciones reales.",
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
  const parsed = reportSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data
}
