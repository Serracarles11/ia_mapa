"use client"

import { useEffect, useMemo, useState } from "react"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type AiReport, type ContextData } from "@/lib/types"
import ChatView from "@/components/ChatView"
import LayerControls, {
  type LayerKey,
  type LayerState,
} from "@/components/LayerControls"
import ReportView from "@/components/ReportView"
import { useIsMobile } from "@/hooks/use-mobile"
import { Download, ShieldAlert, Wind } from "lucide-react"

export type RightPanelProps = {
  status: "idle" | "loading" | "ready" | "error"
  report: AiReport | null
  aiReport: AiReport | null
  context: ContextData | null
  placeName: string | null
  coords: { lat: number; lon: number } | null
  radius: number
  warning: string | null
  statusCode: "OK" | "NO_POIS" | "OVERPASS_DOWN" | null
  errorMessage: string | null
  requestId: number | null
  floodOk: boolean | null
  floodError: string | null
  floodStatus: "OK" | "DOWN" | "VISUAL_ONLY" | null
  airOk: boolean | null
  airError: string | null
  airStatus: "OK" | "DOWN" | "VISUAL_ONLY" | null
  layers: LayerState
  onToggleLayer: (layer: LayerKey, next: boolean) => void
  onRetry: () => void
}

export default function RightPanel({
  status,
  report,
  aiReport,
  context,
  placeName,
  coords,
  radius,
  warning,
  statusCode,
  errorMessage,
  requestId,
  floodOk,
  floodError,
  floodStatus,
  airOk,
  airError,
  airStatus,
  layers,
  onToggleLayer,
  onRetry,
}: RightPanelProps) {
  const isMobile = useIsMobile()
  const [exportStatus, setExportStatus] = useState<"idle" | "loading" | "error">(
    "idle"
  )

  useEffect(() => {
    setExportStatus("idle")
  }, [requestId])
  const floodServiceOk =
    typeof floodOk === "boolean"
      ? floodOk
      : context?.flood_risk?.ok ?? null
  const floodDisabled = !context || floodServiceOk === false
  const floodHint = !context
    ? "Selecciona un punto para habilitar la capa."
    : floodServiceOk === false
      ? floodError || "Capa inundacion no disponible (fuente caida)."
      : floodStatus === "VISUAL_ONLY"
        ? "Capa inundacion disponible solo como visual."
        : "Capa oficial de inundacion (WMS)."
  const airServiceOk =
    typeof airOk === "boolean" ? airOk : context?.air_quality?.ok ?? null
  const airDisabled = !context || airServiceOk === false
  const airHint = !context
    ? "Selecciona un punto para habilitar la capa."
    : airServiceOk === false
      ? airError || "Servicio CAMS no disponible."
      : airStatus === "VISUAL_ONLY"
        ? "Capa CAMS solo visual."
        : "Capa CAMS (calidad del aire)."

  const sources = useMemo(() => {
    const chips: string[] = []
    if (context?.sources.osm.nominatim || context?.sources.osm.overpass) {
      chips.push("OSM")
    }
    if (context?.sources.copernicus.corine || context?.sources.copernicus.efas || context?.sources.copernicus.cams) {
      chips.push("Copernicus")
    }
    if (context?.sources.ign.layers.length || context?.sources.ign.flood_wms) {
      chips.push("IGN")
    }
    if (context?.sources.wikidata) {
      chips.push("Wikidata")
    }
    if (context?.sources.wikipedia) {
      chips.push("Wikipedia")
    }
    if (context?.sources.geoapify) {
      chips.push("Geoapify")
    }
    if (context?.sources.open_meteo) {
      chips.push("Open-Meteo")
    }
    return chips
  }, [context?.sources])

  async function handleExportPdf() {
    if (!report || exportStatus === "loading") return
    setExportStatus("loading")
    try {
      const res = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName,
          coords,
          radius,
          report,
          contextData: context,
          timestamp: new Date().toISOString(),
        }),
      })

      if (!res.ok) {
        throw new Error("Export failed")
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const safeName = (placeName || "informe")
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .slice(0, 40)
      link.href = url
      link.download = `${safeName || "informe"}-${Date.now()}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setExportStatus("idle")
    } catch {
      setExportStatus("error")
      window.setTimeout(() => setExportStatus("idle"), 2000)
    }
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white/95 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        {placeName || "Informe del lugar"}
      </div>
      <div className="flex items-center gap-2">
        {sources.map((chip) => (
          <Badge key={chip} variant="outline" className="text-[11px]">
            {chip}
          </Badge>
        ))}
        {exportStatus === "error" && (
          <Badge variant="destructive" className="text-[11px]">
            Error PDF
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleExportPdf}
          disabled={!report || exportStatus === "loading"}
          className="h-7 px-2 text-xs"
        >
          <Download className="size-3" />
          {exportStatus === "loading" ? "Exportando..." : "Exportar PDF"}
        </Button>
      </div>
    </div>
  )

  const summary = (
    <div className="border-b bg-white/95 px-4 py-3">
      {context ? (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Wind className="size-3" />
              Calidad del aire
            </div>
            <div className="mt-1 text-sm font-semibold">
              {getAirLabel(context)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {getAirDetails(context)}
            </div>
          </div>
          <div className="rounded-lg border bg-white px-3 py-2 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldAlert className="size-3" />
              Peligros
            </div>
            <div className="mt-1 text-sm font-semibold">
              Riesgo inundacion: {getFloodLabel(context)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {getFloodDetails(context)}
            </div>
            {getWaterwaySummary(context) && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Agua cercana: {getWaterwaySummary(context)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          Selecciona un punto para ver calidad del aire y riesgos.
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-0 bg-white/90 shadow-sm backdrop-blur">
        {header}
        {summary}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Accordion className="space-y-3">
            <AccordionItem open>
              <AccordionTrigger>Informe</AccordionTrigger>
              <AccordionContent>
                <ReportView
                  status={status}
                  report={report}
                  context={context}
                  placeName={placeName}
                  coords={coords}
                  radius={radius}
                  warning={warning}
                  statusCode={statusCode}
                  errorMessage={errorMessage}
                  onRetry={onRetry}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem>
              <AccordionTrigger>Capas</AccordionTrigger>
              <AccordionContent>
                <LayerControls
                  layers={layers}
                  onToggle={onToggleLayer}
                  floodDisabled={floodDisabled}
                  floodHint={floodHint}
                  floodStatus={floodStatus}
                  airDisabled={airDisabled}
                  airHint={airHint}
                  airStatus={airStatus}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem>
              <AccordionTrigger>Chat</AccordionTrigger>
              <AccordionContent>
                <ChatView
                  context={context}
                  aiReport={aiReport}
                  statusCode={statusCode}
                  placeName={placeName}
                  coords={coords}
                  radius={radius}
                  requestId={requestId}
                />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem>
              <AccordionTrigger>Fuentes</AccordionTrigger>
              <AccordionContent>
                <SourcesView context={context} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </Card>
    )
  }

  return (
    <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-0 bg-white/90 shadow-sm backdrop-blur">
      {header}
      {summary}
      <Tabs defaultValue="informe" className="flex h-full min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full grid-cols-4 rounded-none border-b bg-white">
          <TabsTrigger value="informe">Informe</TabsTrigger>
          <TabsTrigger value="capas">Capas</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="fuentes">Fuentes</TabsTrigger>
        </TabsList>

        <TabsContent value="informe" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto p-4">
            <ReportView
              status={status}
              report={report}
              context={context}
              placeName={placeName}
              coords={coords}
              radius={radius}
              warning={warning}
              statusCode={statusCode}
              errorMessage={errorMessage}
              onRetry={onRetry}
            />
          </div>
        </TabsContent>

        <TabsContent value="capas" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto p-4">
            <LayerControls
              layers={layers}
              onToggle={onToggleLayer}
              floodDisabled={floodDisabled}
              floodHint={floodHint}
              floodStatus={floodStatus}
              airDisabled={airDisabled}
              airHint={airHint}
              airStatus={airStatus}
            />
            <div className="mt-4 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
              Activa o desactiva capas para comparar base cartografica y usos del suelo.
            </div>
          </div>
        </TabsContent>

        <TabsContent value="chat" className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col p-4">
            <ChatView
              context={context}
              aiReport={aiReport}
              statusCode={statusCode}
              placeName={placeName}
              coords={coords}
              radius={radius}
              requestId={requestId}
            />
          </div>
        </TabsContent>

        <TabsContent value="fuentes" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto p-4">
            <SourcesView context={context} />
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  )
}

function SourcesView({ context }: { context: ContextData | null }) {
  if (!context) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
        Selecciona un punto para ver fuentes usadas.
      </div>
    )
  }

  const sources = []
  if (context.sources.osm.nominatim || context.sources.osm.overpass) {
    sources.push("OpenStreetMap (Nominatim/Overpass)")
  }
  if (context.sources.copernicus.corine) {
    sources.push("Copernicus CLC 2018")
  }
  if (context.sources.copernicus.efas) {
    sources.push("Copernicus EFAS (flood)")
  }
  if (context.sources.copernicus.cams) {
    sources.push("Copernicus CAMS (aire)")
  }
  if (context.sources.ign.layers.length > 0) {
    sources.push(`IGN WMS: ${context.sources.ign.layers.join(", ")}`)
  }
  if (context.sources.ign.flood_wms) {
    sources.push("MITECO WMS (zonas inundables)")
  }
  if (context.sources.wikidata) {
    sources.push("Wikidata")
  }
  if (context.sources.wikipedia) {
    sources.push("Wikipedia")
  }
  if (context.sources.geoapify) {
    sources.push("Geoapify Places")
  }
  if (context.sources.open_meteo) {
    sources.push("Open-Meteo (meteorologia)")
  }

  return (
    <div className="space-y-2">
      {sources.length === 0 && (
        <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          No hay fuentes disponibles.
        </div>
      )}
      {sources.map((source) => (
        <div
          key={source}
          className="rounded-lg border bg-white px-3 py-2 text-xs text-muted-foreground"
        >
          {source}
        </div>
      ))}
    </div>
  )
}

function getAirLabel(context: ContextData) {
  const air = context.air_quality
  if (!air) return "CAMS no disponible"
  if (air.status === "VISUAL_ONLY") return "CAMS visual"
  if (air.ok) return "CAMS disponible"
  return "CAMS no disponible"
}

function getAirDetails(context: ContextData) {
  const air = context.air_quality
  if (!air) return "Sin datos CAMS."
  if (air.value != null) {
    const unit = air.unit ?? air.units
    return `Valor puntual: ${air.value}${unit ? ` ${unit}` : ""}.`
  }
  return air.details ?? "Sin datos CAMS."
}

function getFloodLabel(context: ContextData) {
  const flood = context.flood_risk
  if (!flood) return "Desconocido"
  if (flood.risk_level === "alto") return "Alto"
  if (flood.risk_level === "medio") return "Medio"
  if (flood.risk_level === "bajo") return "Bajo"
  return "Desconocido"
}

function getFloodDetails(context: ContextData) {
  const flood = context.flood_risk
  if (!flood) return "Sin datos de inundacion disponibles."
  return flood.details ?? "Sin datos de inundacion disponibles."
}

function getWaterwaySummary(context: ContextData) {
  const list = context.environment.nearest_waterways
  if (!list || list.length === 0) return null
  return list
    .slice(0, 2)
    .map((item) => `${item.name || item.type} (${item.distance_m} m)`)
    .join(" | ")
}
