"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { type AiReport, type ContextData } from "@/lib/types"
import { cn } from "@/lib/utils"
import { SendHorizontal, Trash2 } from "lucide-react"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: number
  limits?: string[]
  sourcesUsed?: SourcesUsed
}

type ChatViewProps = {
  context: ContextData | null
  aiReport: AiReport | null
  statusCode: "OK" | "NO_POIS" | "OVERPASS_DOWN" | null
  placeName: string | null
  coords: { lat: number; lon: number } | null
  radius: number
  requestId: number | null
}

type SourcesUsed = {
  total_pois: number
  categories: Record<string, number>
  flood_risk: boolean
  flood_ok: boolean
  land_cover: boolean
}

const quickSuggestions = [
  "Que infraestructura hay cerca?",
  "Hay riesgo de inundacion?",
  "Donde comer cerca?",
  "Hay supermercados proximos?",
]

export default function ChatView({
  context,
  aiReport,
  statusCode,
  placeName,
  coords,
  radius,
  requestId,
}: ChatViewProps) {
  const [input, setInput] = useState("")
  const [chatByRequestId, setChatByRequestId] = useState<
    Record<number, ChatMessage[]>
  >({})
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInput("")
    setStatus("idle")
    setError(null)
  }, [requestId])

  const chatKey = requestId ?? 0
  const messages = chatKey ? chatByRequestId[chatKey] ?? [] : []

  const canChat = Boolean(context)

  const placeLabel = useMemo(() => {
    if (placeName) return placeName
    if (coords) {
      return `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
    }
    return "Lugar sin nombre"
  }, [placeName, coords])

  async function sendMessage(question: string) {
    if (!canChat || !context) {
      setError("No hay datos suficientes para responder.")
      return
    }

    const trimmed = question.trim()
    if (!trimmed) return
    if (status === "loading") return

    setStatus("loading")
    setError(null)

    const messageId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now())

    const userMessage: ChatMessage = {
      id: `${messageId}-user`,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    }

    setChatByRequestId((prev) => ({
      ...prev,
      [chatKey]: [...(prev[chatKey] ?? []), userMessage],
    }))

    try {
      const res = await fetch("/api/place-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextData: context,
          aiReport,
          question: trimmed,
        }),
      })

      if (!res.ok) {
        throw new Error("No se pudo enviar la pregunta")
      }

      const data = (await res.json()) as {
        answer?: string
        limits?: string[]
        sources_used?: SourcesUsed
      }
      const answerText =
        typeof data.answer === "string" && data.answer.trim().length > 0
          ? data.answer.trim()
          : "La IA no pudo generar una respuesta util."

      const assistantMessage: ChatMessage = {
        id: `${messageId}-assistant`,
        role: "assistant",
        content: answerText,
        createdAt: Date.now(),
        limits: Array.isArray(data.limits) ? data.limits : undefined,
        sourcesUsed: isSourcesUsed(data.sources_used)
          ? data.sources_used
          : undefined,
      }

      setChatByRequestId((prev) => ({
        ...prev,
        [chatKey]: [...(prev[chatKey] ?? []), assistantMessage],
      }))

      setInput("")
      setStatus("idle")
    } catch (err) {
      setStatus("error")
      setError("La IA no pudo responder en este momento.")
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="space-y-1 p-3 text-xs text-muted-foreground">
        <div className="text-xs font-semibold uppercase tracking-wide">
          Lugar actual
        </div>
        <div className="text-sm font-semibold text-slate-900">{placeLabel}</div>
        <div>
          {coords ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` : ""}
          {coords ? ` | Radio: ${radius} m` : ""}
        </div>
      </Card>

      {statusCode === "OVERPASS_DOWN" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Overpass no disponible. Se usan los ultimos datos disponibles.
        </div>
      )}

      {!context && (
        <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          Selecciona un punto para habilitar el chat.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {quickSuggestions.map((suggestion) => (
          <Button
            key={suggestion}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => sendMessage(suggestion)}
            disabled={!canChat || status === "loading"}
          >
            {suggestion}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
            Haz una pregunta para recibir recomendaciones basadas en el entorno.
          </div>
        )}

        {messages.map((message, index) => {
          const isUser = message.role === "user"
          const hasLimitHeading = /limitaciones:/i.test(message.content)
          const categoryLine = message.sourcesUsed
            ? formatCategories(message.sourcesUsed.categories)
            : null
          return (
            <div
              key={`${message.id}-${index}`}
              className={cn("flex", isUser ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl border px-3 py-2 text-sm shadow-sm",
                  isUser
                    ? "border-emerald-500/30 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-800"
                )}
              >
                <div className="text-[11px] opacity-70">
                  {formatTimestamp(message.createdAt)}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{message.content}</div>
                {!isUser && message.sourcesUsed && (
                  <div className="mt-2 rounded-md border bg-slate-50 px-2 py-2 text-[11px] text-slate-600">
                    <div className="text-[10px] font-semibold uppercase text-slate-500">
                      Datos usados
                    </div>
                    <div>POIs: {message.sourcesUsed.total_pois}</div>
                    {categoryLine && <div>{categoryLine}</div>}
                    <div>
                      Riesgo inundacion:{" "}
                      {message.sourcesUsed.flood_ok ? "ok" : "no disponible"}
                    </div>
                    <div>
                      Uso del suelo:{" "}
                      {message.sourcesUsed.land_cover ? "CLC disponible" : "sin datos"}
                    </div>
                  </div>
                )}
                {!isUser &&
                  message.limits &&
                  message.limits.length > 0 &&
                  !hasLimitHeading && (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Limitaciones
                      </div>
                      <div>{message.limits.join(" | ")}</div>
                    </div>
                  )}
              </div>
            </div>
          )
        })}

        {status === "loading" && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
              <div className="text-[11px] opacity-70">Ahora</div>
              <div className="mt-1 animate-pulse">Escribiendo...</div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="sticky bottom-0 rounded-xl border bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                sendMessage(input)
              }
            }}
            placeholder="Escribe tu pregunta"
            disabled={!canChat || status === "loading"}
            className="h-9 w-full rounded-md border px-3 text-sm"
          />
          <Button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={!canChat || status === "loading"}
            className="h-9 px-3 text-sm"
          >
            <SendHorizontal className="size-4" />
            Enviar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-2 text-sm"
            aria-label="Limpiar chat"
            onClick={() => {
              if (!chatKey) return
              setChatByRequestId((prev) => ({
                ...prev,
                [chatKey]: [],
              }))
            }}
            disabled={!chatKey || messages.length === 0}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function isSourcesUsed(value: unknown): value is SourcesUsed {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (typeof record.total_pois !== "number") return false
  if (typeof record.flood_risk !== "boolean") return false
  if (typeof record.flood_ok !== "boolean") return false
  if (typeof record.land_cover !== "boolean") return false
  if (!record.categories || typeof record.categories !== "object") return false
  return true
}

function formatCategories(categories: Record<string, number>) {
  const entries = Object.entries(categories).filter(([, count]) => count > 0)
  if (entries.length === 0) return "Sin POIs por categoria"
  return entries.map(([label, count]) => `${label} ${count}`).join(" | ")
}
