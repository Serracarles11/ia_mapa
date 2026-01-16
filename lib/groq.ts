import "server-only"

import { z } from "zod"

import { callLlm, safeJsonParse, type LlmMessage } from "@/lib/llm"
import { buildFallbackReport } from "@/lib/report/buildFallbackReport"
import { type AiReport, type ContextData } from "@/lib/types"

type AiReportResult = {
  report: AiReport
  warning?: string
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

export async function generateAiReport(
  contextData: ContextData,
  placeName: string | null
): Promise<AiReportResult> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "user",
      content: buildUserPrompt(contextData, placeName),
    },
  ]

  const response = await callLlm({
    messages,
    temperature: 0.1,
    responseFormat: "json_object",
  })

  if (!response?.message?.content) {
    return {
      report: buildFallbackReport(contextData, placeName, [
        "IA no disponible o sin respuesta",
      ]),
      warning: "IA no disponible",
    }
  }

  const parsed = safeJsonParse(response.message.content)
  const validation = reportSchema.safeParse(parsed)
  if (!validation.success) {
    return {
      report: buildFallbackReport(contextData, placeName, [
        "Respuesta IA invalida",
      ]),
      warning: "Respuesta IA invalida",
    }
  }

  return { report: validation.data }
}

function buildSystemPrompt() {
  return [
    "Eres un analista geoespacial.",
    "Responde SIEMPRE en castellano.",
    "Usa SOLO los datos del contexto. No inventes.",
    "Si faltan datos, indicalo en limitaciones.",
    "Devuelve SOLO un JSON valido con el esquema requerido.",
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
