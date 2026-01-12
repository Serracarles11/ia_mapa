
"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import {
  ChevronDown,
  Copy,
  Download,
  MapPin,
  SendHorizontal,
  Trash2,
} from "lucide-react"

type PoiItem = {
  name: string
  distance_m: number
  rating?: number | null
  cuisine?: string | null
  price_range?: string | null
  type?: string
  lat?: number
  lon?: number
}

type AiReport = {
  place_name: string | null
  summary_general: string
  restaurants_nearby: PoiItem[]
  ocio_inmediato: Array<PoiItem & { type: "bar" | "cafe" | "club" | "fast_food" }>
  services: {
    pharmacies: PoiItem[]
    hospitals: PoiItem[]
    schools: PoiItem[]
    bus_stops: PoiItem[]
    supermarkets: PoiItem[]
  }
  tourism: {
    hotels: PoiItem[]
    museums: PoiItem[]
    attractions: PoiItem[]
    viewpoints: PoiItem[]
  }
  limited_info: {
    is_limited: boolean
    reason: string | null
  }
}

type ContextPoiBase = {
  name: string
  distance_m: number
  lat?: number
  lon?: number
  rating?: number | null
  cuisine?: string | null
  price_range?: string | null
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

export type SidePanelData = {
  placeName: string | null
  report: AiReport | null
  aiReport?: AiReport | null
  context: ContextData | null
  warning?: string | null
  coords: { lat: number; lon: number } | null
  requestId: number | null
  status: "OK" | "NO_POIS" | "OVERPASS_DOWN" | null
  overpassOk: boolean | null
  overpassError: string | null
}

type SidePanelProps = {
  status: "idle" | "loading" | "ready" | "error"
  data: SidePanelData
  errorMessage: string | null
  selectedRadius: number
  onViewPoi?: (poi: {
    name: string
    lat: number
    lon: number
    distance_m?: number
    type?: string
  }) => void
  onRadiusSuggestion?: (radius: number) => void
  onRetry?: () => void
  onClearSelection?: () => void
  onCenter?: () => void
}

type PlaceChatResponse = {
  answer: string
  sources_used: {
    restaurants: number
    bars_and_clubs: number
    cafes: number
    supermarkets: number
    transport: number
    hotels: number
    tourism: number
  }
  limits?: string[]
}

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: number
  limits?: string[]
}

type FormattedBlock = {
  title?: string
  lines: string[]
  list?: boolean
}

type FormattedAnswer = {
  blocks: FormattedBlock[]
}

const headingRegex =
  /^(Recomendacion principal|Por que|Alternativas|Limitaciones)\s*:\s*(.*)$/i
const headingInsertRegex =
  /(Recomendacion principal|Por que|Alternativas|Limitaciones)\s*:/gi

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function formatAiAnswer(answer: string): FormattedAnswer {
  const raw = typeof answer === "string" ? answer : ""
  let cleaned = raw.replace(/\r\n/g, "\n")

  if (!cleaned.trim()) {
    return {
      blocks: [
        {
          title: "Respuesta",
          lines: ["No hay contenido disponible en este momento."],
        },
      ],
    }
  }

  const trimmed = cleaned.trim()
  const looksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  const technicalMatch = /json_validate_failed|failed_generation|stack|trace/i
  if (looksJson || technicalMatch.test(trimmed)) {
    return {
      blocks: [
        {
          title: "Respuesta",
          lines: ["La IA fallo al generar la respuesta. Puedes reintentar."],
        },
      ],
    }
  }

  cleaned = cleaned
    .replace(headingInsertRegex, "\n$1:")
    .replace(/la informacion sigue siendo la misma\.?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  const technicalPatterns = [
    /json_validate_failed/i,
    /failed_generation/i,
    /stack/i,
    /trace/i,
    /groq/i,
  ]
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !technicalPatterns.some((pattern) => pattern.test(line))
    )

  if (lines.length === 0) {
    return {
      blocks: [
        {
          title: "Respuesta",
          lines: ["La IA fallo al generar la respuesta. Puedes reintentar."],
        },
      ],
    }
  }

  if (
    lines.length === 1 &&
    !lines[0].includes(":") &&
    lines[0].split(",").length >= 3
  ) {
    const items = lines[0]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    return {
      blocks: [
        {
          title: "Resultados",
          lines: items,
          list: true,
        },
      ],
    }
  }

  const blocks: FormattedBlock[] = []
  let current: FormattedBlock = { lines: [] }

  for (const line of lines) {
    const normalizedLine = stripDiacritics(line)
    const headingMatch = normalizedLine.match(headingRegex)
    if (headingMatch) {
      if (current.lines.length > 0) {
        blocks.push(current)
      }
      const content = line.replace(/^[^:]*:\s*/, "")
      current = {
        title: headingMatch[1],
        lines: content ? [content] : [],
      }
      continue
    }

    if (line.startsWith("- ")) {
      current.list = true
      current.lines.push(line.slice(2).trim())
      continue
    }

    current.lines.push(line)
  }

  if (current.lines.length > 0) {
    blocks.push(current)
  }

  const normalizedBlocks = blocks.map((block) => {
    if (block.list) return block
    return {
      ...block,
      lines: block.lines.map((line) => {
        if (!line) return line
        if (/[.!?]$/.test(line)) return line
        return line.endsWith(":") ? line : `${line}.`
      }),
    }
  })

  return {
    blocks:
      normalizedBlocks.length > 0
        ? normalizedBlocks
        : [
            {
              title: "Respuesta",
              lines: ["La IA fallo al generar la respuesta. Puedes reintentar."],
            },
          ],
  }
}

function sanitizeUiText(value: string | null | undefined, fallback: string) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!text) return fallback
  const looksJson =
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  const technical = /json_validate_failed|failed_generation|stack|trace/i
  if (looksJson || technical.test(text)) {
    return fallback
  }
  return text.replace(/\s+/g, " ")
}
function formatDistance(distance: number) {
  if (distance >= 1000) {
    const km = Math.round((distance / 1000) * 10) / 10
    return `${km} km`
  }
  return `${distance} m`
}

const typeLabels: Record<string, string> = {
  restaurant: "Restaurante",
  fast_food: "Fast food",
  bar: "Bar",
  club: "Club",
  cafe: "Cafe",
  pharmacy: "Farmacia",
  hospital: "Hospital",
  school: "Colegio",
  supermarket: "Supermercado",
  bus_stop: "Bus",
  hotel: "Hotel",
  attraction: "Turismo",
  museum: "Museo",
  viewpoint: "Mirador",
}

function formatType(type?: string) {
  if (!type) return null
  return typeLabels[type] ?? type
}

function sortByDistance<T extends { distance_m: number }>(items: T[]) {
  return [...items].sort((a, b) => a.distance_m - b.distance_m)
}

function isReportEmpty(report: AiReport) {
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

function buildReportFromContext(context: ContextData): AiReport {
  const restaurants: PoiItem[] = context.pois.restaurants.map((item) => ({
    name: item.name,
    distance_m: item.distance_m,
    rating: item.rating ?? null,
    cuisine: null,
    price_range: null,
  }))

  const ocioBars: Array<PoiItem & { type: "bar" | "club" }> =
    context.pois.bars_and_clubs.map((item) => ({
    name: item.name,
    distance_m: item.distance_m,
    type: item.type === "club" ? "club" : "bar",
  }))

  const ocioCafes: Array<PoiItem & { type: "cafe" }> =
    context.pois.cafes.map((item) => ({
    name: item.name,
    distance_m: item.distance_m,
    type: "cafe" as const,
  }))

  const ocioFastFood: Array<PoiItem & { type: "fast_food" }> = context.pois.restaurants
    .filter((item) => item.type === "fast_food")
    .map((item) => ({
      name: item.name,
      distance_m: item.distance_m,
      type: "fast_food" as const,
    }))

  const ocioInmediato: Array<
    PoiItem & { type: "bar" | "club" | "cafe" | "fast_food" }
  > = [...ocioBars, ...ocioCafes, ...ocioFastFood].sort(
    (a, b) => a.distance_m - b.distance_m
  )

  const totalPois =
    restaurants.length +
    ocioBars.length +
    ocioCafes.length +
    ocioFastFood.length +
    context.pois.pharmacies.length +
    context.pois.hospitals.length +
    context.pois.schools.length +
    context.pois.supermarkets.length +
    context.pois.transport.length +
    context.pois.hotels.length +
    context.pois.tourism.length +
    context.pois.museums.length +
    context.pois.viewpoints.length

  return {
    place_name: null,
    summary_general:
      "Resumen basado en datos OSM sin procesamiento IA. Las secciones muestran datos reales cercanos.",
    restaurants_nearby: restaurants,
    ocio_inmediato: ocioInmediato,
    services: {
      pharmacies: context.pois.pharmacies.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      hospitals: context.pois.hospitals.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      schools: context.pois.schools.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      bus_stops: context.pois.transport.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      supermarkets: context.pois.supermarkets.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
    },
    tourism: {
      hotels: context.pois.hotels.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      museums: context.pois.museums.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      attractions: context.pois.tourism.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
      viewpoints: context.pois.viewpoints.map((item) => ({
        name: item.name,
        distance_m: item.distance_m,
      })),
    },
    limited_info: {
      is_limited: totalPois === 0,
      reason: totalPois === 0 ? "Sin datos reales en el radio" : null,
    },
  }
}

function getEffectiveReport(data: SidePanelData) {
  if (data.report && !isReportEmpty(data.report)) {
    return data.report
  }
  if (data.context) {
    return buildReportFromContext(data.context)
  }
  return data.report
}

function hasPois(context: ContextData | null) {
  if (!context) return false
  const pois = context.pois
  return (
    pois.restaurants.length > 0 ||
    pois.bars_and_clubs.length > 0 ||
    pois.cafes.length > 0 ||
    pois.pharmacies.length > 0 ||
    pois.hospitals.length > 0 ||
    pois.schools.length > 0 ||
    pois.supermarkets.length > 0 ||
    pois.transport.length > 0 ||
    pois.hotels.length > 0 ||
    pois.tourism.length > 0 ||
    pois.museums.length > 0 ||
    pois.viewpoints.length > 0
  )
}

function buildPoiKey(item: PoiItem, key: string, index: number) {
  return `${key}-${item.name}-${item.distance_m}-${item.type ?? "poi"}-${index}`
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
export default function SidePanel({
  status,
  data,
  errorMessage,
  selectedRadius,
  onViewPoi,
  onRadiusSuggestion,
  onRetry,
  onClearSelection,
  onCenter,
}: SidePanelProps) {
  const [chatInput, setChatInput] = useState("")
  const [chatByRequestId, setChatByRequestId] = useState<
    Record<number, ChatMessage[]>
  >({})
  const [chatStatus, setChatStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  )
  const [chatError, setChatError] = useState<string | null>(null)
  const [onlyClose, setOnlyClose] = useState(false)
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({})
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null)

  useEffect(() => {
    setChatInput("")
    setChatStatus("idle")
    setChatError(null)
    setToolbarNotice(null)
  }, [data.requestId])

  const report = getEffectiveReport(data)
  const coords = data.coords
  const radius = data.context?.radius_m ?? selectedRadius
  const isOverpassDown = data.status === "OVERPASS_DOWN"
  const isNoPois = data.status === "NO_POIS"
  const hasContext = Boolean(data.context)
  const canChat = hasContext || isOverpassDown
  const hasCoords = Boolean(coords)
  const showRetry = status === "error" || isOverpassDown
  const requestKey = data.requestId ?? 0
  const chatHistory = requestKey ? chatByRequestId[requestKey] ?? [] : []

  const distanceLimit = onlyClose ? 500 : null

  const context = data.context
  const restaurants = useMemo(() => {
    const list = context?.pois.restaurants ?? []
    const filtered = list.filter((item) => item.type === "restaurant")
    return sortByDistance(filtered)
  }, [context])
  const fastFood = useMemo(() => {
    const list = context?.pois.restaurants ?? []
    const filtered = list.filter((item) => item.type === "fast_food")
    return sortByDistance(filtered)
  }, [context])
  const barsAndClubs = useMemo(
    () => sortByDistance(context?.pois.bars_and_clubs ?? []),
    [context]
  )
  const cafes = useMemo(
    () => sortByDistance(context?.pois.cafes ?? []),
    [context]
  )
  const supermarkets = useMemo(
    () => sortByDistance(context?.pois.supermarkets ?? []),
    [context]
  )
  const transport = useMemo(
    () => sortByDistance(context?.pois.transport ?? []),
    [context]
  )
  const hotels = useMemo(
    () => sortByDistance(context?.pois.hotels ?? []),
    [context]
  )
  const pharmacies = useMemo(
    () => sortByDistance(context?.pois.pharmacies ?? []),
    [context]
  )
  const hospitals = useMemo(
    () => sortByDistance(context?.pois.hospitals ?? []),
    [context]
  )
  const schools = useMemo(
    () => sortByDistance(context?.pois.schools ?? []),
    [context]
  )
  const tourism = useMemo(
    () => sortByDistance(context?.pois.tourism ?? []),
    [context]
  )
  const museums = useMemo(
    () => sortByDistance(context?.pois.museums ?? []),
    [context]
  )
  const viewpoints = useMemo(
    () => sortByDistance(context?.pois.viewpoints ?? []),
    [context]
  )

  const counts = useMemo(() => {
    return {
      restaurants: restaurants.length + fastFood.length,
      bars: barsAndClubs.length,
      cafes: cafes.length,
      supermarkets: supermarkets.length,
      bus: transport.length,
      hotels: hotels.length,
      tourism: tourism.length + museums.length + viewpoints.length,
    }
  }, [
    restaurants.length,
    fastFood.length,
    barsAndClubs.length,
    cafes.length,
    supermarkets.length,
    transport.length,
    hotels.length,
    tourism.length,
    museums.length,
    viewpoints.length,
  ])

  const servicesCount = pharmacies.length + hospitals.length + schools.length
  const tourismCount = tourism.length + museums.length + viewpoints.length

  const shouldShowFallbackBanner =
    status === "ready" &&
    data.status === "OK" &&
    !data.aiReport &&
    Boolean(data.report)

  async function handleSendQuestion(questionOverride?: string) {
    if (!canChat) {
      setChatError("Haz click en el mapa primero.")
      return
    }
    if (chatStatus === "loading") return
    const question = (questionOverride ?? chatInput).trim()
    if (!question) return

    setChatStatus("loading")
    setChatError(null)

    const messageId = `${Date.now()}-${Math.round(Math.random() * 10000)}`
    const userMessage: ChatMessage = {
      id: `${messageId}-user`,
      role: "user",
      content: question,
      createdAt: Date.now(),
    }

    if (requestKey) {
      setChatByRequestId((prev) => ({
        ...prev,
        [requestKey]: [...(prev[requestKey] ?? []), userMessage],
      }))
    }

    try {
      const res = await fetch("/api/place-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextData: data.context,
          aiReport: data.aiReport ?? null,
          status: data.status ?? undefined,
          question,
        }),
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || "No se pudo enviar la pregunta.")
      }

      const response = (await res.json()) as PlaceChatResponse
      const assistantMessage: ChatMessage = {
        id: `${messageId}-assistant`,
        role: "assistant",
        content: response.answer,
        limits: response.limits,
        createdAt: Date.now(),
      }

      if (requestKey) {
        setChatByRequestId((prev) => ({
          ...prev,
          [requestKey]: [...(prev[requestKey] ?? []), assistantMessage],
        }))
      }
      setChatInput("")
      setChatStatus("idle")
    } catch (err) {
      console.debug("Fallo al enviar chat", err)
      setChatError(
        "La IA no ha podido responder ahora mismo. Intenta de nuevo."
      )
      setChatStatus("error")
    }
  }

  async function handleCopyName(name: string) {
    try {
      await navigator.clipboard.writeText(name)
    } catch (error) {
      console.debug("No se pudo copiar el nombre", error)
    }
  }

  async function handleExportReport() {
    if (!report) return
    const lines: string[] = []
    lines.push("Informe de entorno")
    if (data.placeName) {
      lines.push(`Lugar: ${data.placeName}`)
    }
    if (coords) {
      lines.push(
        `Coordenadas: ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
      )
    }
    lines.push(`Radio: ${radius} m`)
    lines.push("")
    lines.push("Resumen:")
    lines.push(report.summary_general)
    lines.push("")
    lines.push("Conteos:")
    lines.push(`- Restaurantes: ${counts.restaurants}`)
    lines.push(`- Bares y clubes: ${counts.bars}`)
    lines.push(`- Cafes: ${counts.cafes}`)
    lines.push(`- Supermercados: ${counts.supermarkets}`)
    lines.push(`- Bus: ${counts.bus}`)
    lines.push(`- Hoteles: ${counts.hotels}`)
    lines.push(`- Turismo: ${counts.tourism}`)

    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      setExportNotice("Informe copiado")
    } catch (error) {
      console.debug("No se pudo exportar el informe", error)
      setExportNotice("No se pudo copiar")
    } finally {
      window.setTimeout(() => setExportNotice(null), 1800)
    }
  }

  function pushToolbarNotice(message: string) {
    setToolbarNotice(message)
    window.setTimeout(() => setToolbarNotice(null), 1500)
  }

  async function handleToolbarCopyCoords() {
    if (!coords) return
    const text = `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
    try {
      await navigator.clipboard.writeText(text)
      pushToolbarNotice("Copiado")
    } catch (error) {
      console.debug("No se pudieron copiar las coordenadas", error)
      pushToolbarNotice("No se pudo copiar")
    }
  }

  async function handleShare() {
    if (!coords) return
    try {
      const url = new URL(window.location.href)
      url.searchParams.set("lat", coords.lat.toFixed(6))
      url.searchParams.set("lon", coords.lon.toFixed(6))
      url.searchParams.set("radius", String(radius))
      await navigator.clipboard.writeText(url.toString())
      pushToolbarNotice("Enlace copiado")
    } catch (error) {
      console.debug("No se pudo compartir el enlace", error)
      pushToolbarNotice("No se pudo copiar")
    }
  }

  function handleResetPanel() {
    setChatByRequestId({})
    setChatInput("")
    setChatStatus("idle")
    setChatError(null)
    setExpandedSections({})
    setOnlyClose(false)
    setExportNotice(null)
    setToolbarNotice(null)
    if (onClearSelection) {
      onClearSelection()
    }
  }

  function renderPoiList(
    key: string,
    items: PoiItem[],
    limit = 6
  ): React.ReactNode {
    const filtered = distanceLimit
      ? items.filter((item) => item.distance_m <= distanceLimit)
      : items
    const isExpanded = expandedSections[key] ?? false
    const visible = isExpanded ? filtered : filtered.slice(0, limit)
    const hiddenCount = filtered.length - visible.length

    if (filtered.length === 0) {
      return (
        <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Sin datos disponibles.
        </div>
      )
    }

    return (
      <div className="space-y-2">
        {visible.map((item, index) => {
          const typeLabel = formatType(item.type)
          const canView =
            typeof item.lat === "number" && typeof item.lon === "number"
          return (
            <div
              key={buildPoiKey(item, key, index)}
              className="flex flex-col gap-2 rounded-lg border bg-white/70 px-3 py-2 shadow-sm sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {formatDistance(item.distance_m)}
                  </Badge>
                  {typeLabel && (
                    <Badge variant="outline">{typeLabel}</Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    if (!canView || !onViewPoi) return
                    onViewPoi({
                      name: item.name,
                      lat: item.lat as number,
                      lon: item.lon as number,
                      distance_m: item.distance_m,
                      type: item.type,
                    })
                  }}
                  disabled={!canView || !onViewPoi}
                >
                  <MapPin className="size-3" />
                  Ver en mapa
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleCopyName(item.name)}
                >
                  <Copy className="size-3" />
                  Copiar nombre
                </Button>
              </div>
            </div>
          )
        })}
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setExpandedSections((prev) => ({
                ...prev,
                [key]: !isExpanded,
              }))
            }
          >
            {isExpanded ? "Ver menos" : `Ver mas (${hiddenCount})`}
          </Button>
        )}
      </div>
    )
  }
  function renderFormattedAnswer(message: ChatMessage) {
    const formatted = formatAiAnswer(message.content)
    return (
      <div className="space-y-3">
        {formatted.blocks.map((block, blockIndex) => (
          <div key={`${message.id}-block-${blockIndex}`} className="space-y-1">
            {block.title && (
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {block.title}
              </div>
            )}
            {block.list ? (
              <div className="space-y-1 text-sm">
                {block.lines.map((line, lineIndex) => (
                  <div
                    key={`${message.id}-line-${blockIndex}-${lineIndex}`}
                    className="flex gap-2"
                  >
                    <span className="text-emerald-600">-</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            ) : (
              block.lines.map((line, lineIndex) => (
                <p
                  key={`${message.id}-line-${blockIndex}-${lineIndex}`}
                  className="text-sm text-slate-700"
                >
                  {line}
                </p>
              ))
            )}
          </div>
        ))}
        {message.limits && message.limits.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <div className="mb-1 font-semibold">Limitaciones</div>
            <div className="space-y-1">
              {message.limits.map((limit, index) => (
                <div key={`${message.id}-limit-${index}`}>- {limit}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const quickSuggestions = [
    "Cual es el mejor restaurante cercano?",
    "Que bares hay a menos de 500m?",
    "Hay supermercados cerca?",
    "Que recomiendas para cenar?",
  ]

  const nextRadiusSuggestion = useMemo(() => {
    const options = [500, 800, 1200, 2000]
    const currentIndex = options.findIndex((option) => option === radius)
    if (currentIndex === -1 || currentIndex === options.length - 1) {
      return 2000
    }
    return options[currentIndex + 1]
  }, [radius])

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-base">Panel de analisis</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          {showRetry && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={onRetry}
              disabled={!onRetry || !hasCoords || status === "loading"}
            >
              Reintentar
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={handleResetPanel}
          >
            Limpiar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onCenter}
            disabled={!hasCoords || !onCenter}
          >
            Centrar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={handleToolbarCopyCoords}
            disabled={!hasCoords}
          >
            Copiar coords
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={handleShare}
            disabled={!hasCoords}
          >
            Compartir
          </Button>
          {toolbarNotice && (
            <span className="text-xs text-muted-foreground">
              {toolbarNotice}
            </span>
          )}
        </div>
        <Tabs
          defaultValue="informe"
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList className="w-full justify-between">
            <TabsTrigger value="informe" className="flex-1">
              Informe
            </TabsTrigger>
            <TabsTrigger value="preguntar" className="flex-1">
              Preguntar
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="informe"
            className="flex-1 min-h-0 overflow-y-auto pr-1"
          >
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span>Lugar actual</span>
                      {isOverpassDown && report && (
                        <Badge variant="outline" className="h-5 px-2 text-[10px]">
                          Ultimo informe valido
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm font-semibold">
                      {data.placeName || "Lugar sin nombre"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {coords
                        ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
                        : "Selecciona un punto en el mapa"}
                      {radius ? ` | Radio: ${radius} m` : ""}
                    </div>
                  </div>
                  <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
                    {hasContext && (
                      <Badge variant="secondary">Ordenado por cercania</Badge>
                    )}
                    <Toggle
                      pressed={onlyClose}
                      onPressedChange={setOnlyClose}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={!hasContext}
                    >
                      Solo &lt; 500m
                    </Toggle>
                  </div>
                </div>
                {hasContext && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      Restaurantes: {counts.restaurants}
                    </Badge>
                    <Badge variant="secondary">Bares: {counts.bars}</Badge>
                    <Badge variant="secondary">Cafes: {counts.cafes}</Badge>
                    <Badge variant="secondary">
                      Supermercados: {counts.supermarkets}
                    </Badge>
                    <Badge variant="secondary">Bus: {counts.bus}</Badge>
                    <Badge variant="secondary">Hoteles: {counts.hotels}</Badge>
                    <Badge variant="secondary">Turismo: {counts.tourism}</Badge>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={handleExportReport}
                    disabled={!report}
                  >
                    <Download className="size-3" />
                    Exportar informe
                  </Button>
                  {exportNotice && (
                    <span className="text-xs text-muted-foreground">
                      {exportNotice}
                    </span>
                  )}
                </div>
              </div>

              {isOverpassDown && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                  <div className="font-semibold">
                    El servicio de datos del mapa (Overpass) no esta disponible
                    ahora mismo.
                  </div>
                  <div className="mt-1">
                    {report
                      ? "Mostrando el ultimo informe valido."
                      : "No se puede generar informe en este momento."}
                  </div>
                </div>
              )}

              {shouldShowFallbackBanner && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  La IA no ha podido generar el texto ahora mismo. Mostrando
                  datos OSM.
                </div>
              )}

              {status === "idle" && (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  Haz click en el mapa para generar el informe del entorno.
                </div>
              )}

              {status === "loading" && <ReportSkeleton />}

              {status === "error" && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {sanitizeUiText(
                    errorMessage,
                    "No se pudo generar el informe."
                  )}
                </div>
              )}

              {status === "ready" && report && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-sm font-semibold">
                      {isOverpassDown
                        ? "Resumen del ultimo informe"
                        : "Resumen general"}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {sanitizeUiText(
                        report.summary_general,
                        "Resumen no disponible en este momento."
                      )}
                    </p>
                    {!isOverpassDown && report.limited_info.is_limited && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Informacion limitada:{" "}
                        {sanitizeUiText(
                          report.limited_info.reason,
                          "datos escasos"
                        )}
                        .
                      </div>
                    )}
                  </div>

                  {!isOverpassDown && isNoPois && (
                    <div className="rounded-xl border border-dashed px-4 py-4 text-sm text-muted-foreground">
                      <div className="font-semibold text-slate-700">
                        No hay POIs dentro del radio.
                      </div>
                      <div className="mt-1">
                        Prueba con un radio mayor para obtener mas resultados.
                      </div>
                      {onRadiusSuggestion && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 h-7 px-2 text-xs"
                          onClick={() => onRadiusSuggestion(nextRadiusSuggestion)}
                        >
                          Probar con {nextRadiusSuggestion} m
                        </Button>
                      )}
                    </div>
                  )}

                  <Accordion>
                    {(!isOverpassDown || restaurants.length > 0) && (
                      <AccordionItem open>
                        <AccordionTrigger>
                          <span>Restaurantes</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {restaurants.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("restaurants", restaurants)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || barsAndClubs.length > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Bares y clubes</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {barsAndClubs.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("bars", barsAndClubs)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || cafes.length > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Cafes</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {cafes.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("cafes", cafes)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || fastFood.length > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Fast food</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {fastFood.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("fast-food", fastFood)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || supermarkets.length > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Supermercados</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {supermarkets.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("supermarkets", supermarkets)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || transport.length > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Transporte</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {transport.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("transport", transport)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || hotels.length > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Hoteles</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {hotels.length}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          {renderPoiList("hotels", hotels)}
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || servicesCount > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Servicios</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {servicesCount}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3">
                            {(!isOverpassDown || pharmacies.length > 0) && (
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Farmacias
                                </div>
                                {renderPoiList("pharmacies", pharmacies)}
                              </div>
                            )}
                            {(!isOverpassDown || hospitals.length > 0) && (
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Hospitales
                                </div>
                                {renderPoiList("hospitals", hospitals)}
                              </div>
                            )}
                            {(!isOverpassDown || schools.length > 0) && (
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Colegios
                                </div>
                                {renderPoiList("schools", schools)}
                              </div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {(!isOverpassDown || tourismCount > 0) && (
                      <AccordionItem>
                        <AccordionTrigger>
                          <span>Turismo</span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            {tourismCount}
                            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
                          </span>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3">
                            {(!isOverpassDown || tourism.length > 0) && (
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Atracciones
                                </div>
                                {renderPoiList("tourism", tourism)}
                              </div>
                            )}
                            {(!isOverpassDown || museums.length > 0) && (
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Museos
                                </div>
                                {renderPoiList("museums", museums)}
                              </div>
                            )}
                            {(!isOverpassDown || viewpoints.length > 0) && (
                              <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Miradores
                                </div>
                                {renderPoiList("viewpoints", viewpoints)}
                              </div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </div>
              )}

              {status === "ready" && !report && !isOverpassDown && (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  No hay datos disponibles para este punto.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="preguntar"
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
            <div className="rounded-xl border bg-muted/40 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lugar actual
              </div>
              <div className="text-sm font-semibold">
                {data.placeName || "Lugar sin nombre"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {coords
                  ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
                  : "Selecciona un punto en el mapa"}
                {radius ? ` | Radio: ${radius} m` : ""}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {quickSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleSendQuestion(suggestion)}
                  disabled={!canChat || chatStatus === "loading"}
                >
                  {suggestion}
                </Button>
              ))}
            </div>

            {isOverpassDown && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Los datos del mapa no estan disponibles ahora mismo. El chat
                solo puede responder con esa limitacion.
              </div>
            )}

            {!canChat && (
              <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
                Haz click en el mapa primero para habilitar el chat.
              </div>
            )}

            <div className="flex min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {chatHistory.length === 0 && (
                <div className="rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
                  Haz una pregunta para recibir recomendaciones basadas en el
                  entorno.
                </div>
              )}
              {chatHistory.map((message, index) => {
                const isUser = message.role === "user"
                return (
                  <div
                    key={`${message.id}-${index}`}
                    className={cn(
                      "flex",
                      isUser ? "justify-end" : "justify-start"
                    )}
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
                      <div className="mt-1">
                        {isUser ? (
                          <p>{message.content}</p>
                        ) : (
                          renderFormattedAnswer(message)
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              {chatStatus === "loading" && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">
                    <div className="text-[11px] opacity-70">Ahora</div>
                    <div className="mt-1 animate-pulse">Escribiendo...</div>
                  </div>
                </div>
              )}
            </div>

            {chatError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {sanitizeUiText(
                  chatError,
                  "La IA no pudo generar la respuesta ahora mismo."
                )}
              </div>
            )}

            <div className="sticky bottom-0 rounded-xl border bg-white/95 p-3 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      handleSendQuestion()
                    }
                  }}
                  placeholder="Escribe tu pregunta"
                  disabled={!canChat || chatStatus === "loading"}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                />
                <Button
                  type="button"
                  onClick={() => handleSendQuestion()}
                  disabled={!canChat || chatStatus === "loading"}
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
                    if (!requestKey) return
                    setChatByRequestId((prev) => ({
                      ...prev,
                      [requestKey]: [],
                    }))
                  }}
                  disabled={!requestKey || chatHistory.length === 0}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
