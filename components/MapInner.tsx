"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Circle,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip as LeafletTooltip,
  WMSTileLayer,
  useMapEvent,
} from "react-leaflet"
import L, { type LeafletMouseEvent } from "leaflet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { toast } from "@/lib/ui/toast"
import { type AiReport, type ContextData } from "@/lib/types"
import RightPanel from "@/components/RightPanel"
import SearchBar from "@/components/SearchBar"
import { type LayerKey, type LayerState } from "@/components/LayerControls"
import {
  Copy,
  Eraser,
  Loader2,
  LocateFixed,
  MapPin,
} from "lucide-react"

const RADIUS_OPTIONS = [500, 800, 1200, 2000]

const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
const IGN_WMS_URL = "https://www.ign.es/wms-inspire/ign-base"
const IGN_WMS_LAYER = "IGNBaseTodo"
const PNOA_WMS_URL = "https://www.ign.es/wms-inspire/pnoa-ma"
const PNOA_WMS_LAYER = "OI.OrthoimageCoverage"
const CLC_WMS_URL =
  "https://image.discomap.eea.europa.eu/arcgis/services/Corine/CLC2018_WM/MapServer/WMSServer"
const CLC_WMS_LAYER = "13"
const FLOOD_WMS_URL =
  "https://servicios.mapama.gob.es/arcgis/services/Agua/Riesgo/MapServer/WMSServer"
const FLOOD_WMS_LAYER = "AreaImp_100"

type MapInnerProps = {
  initialLat?: number | null
  initialLon?: number | null
  initialRadius?: number | null
}

type AnalyzeResponse = {
  ok: boolean
  request_id?: number | null
  placeName?: string | null
  contextData?: ContextData | null
  overpass_ok?: boolean
  overpass_error?: string | null
  flood_ok?: boolean
  flood_error?: string | null
  flood_status?: "OK" | "DOWN"
  status?: "OK" | "NO_POIS" | "OVERPASS_DOWN"
  aiReport?: AiReport | null
  fallbackReport?: AiReport | null
  warnings?: string[]
  warning?: string | null
  error?: string
}

type PanelData = {
  placeName: string | null
  report: AiReport | null
  aiReport: AiReport | null
  context: ContextData | null
  warning: string | null
  coords: { lat: number; lon: number } | null
  requestId: number | null
  status: "OK" | "NO_POIS" | "OVERPASS_DOWN" | null
  overpassOk: boolean | null
  overpassError: string | null
  floodOk: boolean | null
  floodError: string | null
  floodStatus: "OK" | "DOWN" | null
}

function ClickHandler({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvent("click", (event: LeafletMouseEvent) => {
    onClick(event.latlng.lat, event.latlng.lng)
  })
  return null
}

export default function MapInner({
  initialLat,
  initialLon,
  initialRadius,
}: MapInnerProps) {
  const [radiusMeters, setRadiusMeters] = useState(() => {
    const initial =
      typeof initialRadius === "number" && initialRadius > 0
        ? Math.round(initialRadius)
        : 1200
    return RADIUS_OPTIONS.includes(initial) ? initial : 1200
  })
  const [position, setPosition] = useState<[number, number] | null>(null)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  )
  const [panelData, setPanelData] = useState<PanelData>({
    placeName: null,
    report: null,
    aiReport: null,
    context: null,
    warning: null,
    coords: null,
    requestId: null,
    status: null,
    overpassOk: null,
    overpassError: null,
    floodOk: null,
    floodError: null,
    floodStatus: null,
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchValue, setSearchValue] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const [layers, setLayers] = useState<LayerState>({
    osm: true,
    ign: false,
    pnoa: false,
    clc: false,
    flood: false,
  })

  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const lastGoodRef = useRef<PanelData | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const autoAnalyzeRef = useRef(false)

  const initialCenter = useMemo<[number, number]>(() => {
    if (typeof initialLat === "number" && typeof initialLon === "number") {
      return [initialLat, initialLon]
    }
    return [40.4168, -3.7038]
  }, [initialLat, initialLon])

  useEffect(() => {
    if (typeof window === "undefined") return
    type IconDefaultPrototype = { _getIconUrl?: () => string }
    const iconDefaultPrototype = L.Icon.Default.prototype as IconDefaultPrototype
    delete iconDefaultPrototype._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    })
  }, [])

  const analyzePlace = useCallback(
    async (lat: number, lon: number, radius: number) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      setStatus("loading")
      setErrorMessage(null)
      setPanelData((prev) => ({
        ...prev,
        placeName: null,
        report: null,
        aiReport: null,
        context: null,
        warning: null,
        coords: { lat, lon },
        requestId,
        status: null,
        overpassOk: null,
        overpassError: null,
        floodOk: null,
        floodError: null,
        floodStatus: null,
      }))

      toast("Analizando entorno...")

      try {
        const res = await fetch("/api/analyze-place", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            center: { lat, lon },
            radius_m: radius,
            request_id: requestId,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(errorText || "No se pudo analizar el lugar.")
        }

        const data = (await res.json()) as AnalyzeResponse
        const responseId = data.request_id ?? requestId
        if (responseId !== requestIdRef.current) return
        if (!data.ok) {
          throw new Error(data.error || "No se pudo analizar el lugar.")
        }

        const responseStatus = data.status ?? "OK"
        const warnings =
          Array.isArray(data.warnings) && data.warnings.length > 0
            ? data.warnings
            : data.warning
              ? [data.warning]
              : []

        const floodOk =
          typeof data.flood_ok === "boolean"
            ? data.flood_ok
            : data.contextData?.flood_risk?.ok ?? null
        const floodError =
          typeof data.flood_error === "string"
            ? data.flood_error
            : data.contextData?.flood_risk?.ok
              ? null
              : data.contextData?.flood_risk?.details ?? null
        const floodStatus =
          data.flood_status ??
          (floodOk === null ? null : floodOk ? "OK" : "DOWN")

        const nextData: PanelData = {
          placeName: data.placeName ?? null,
          report: data.aiReport ?? data.fallbackReport ?? null,
          aiReport: data.aiReport ?? null,
          context: data.contextData ?? null,
          warning: warnings.length > 0 ? warnings.join(" | ") : null,
          coords: { lat, lon },
          requestId: responseId,
          status: responseStatus,
          overpassOk: data.overpass_ok ?? null,
          overpassError: data.overpass_error ?? null,
          floodOk,
          floodError,
          floodStatus,
        }

        if (responseStatus === "OVERPASS_DOWN") {
          const fallback = lastGoodRef.current
          const fallbackCoords = fallback?.coords ?? nextData.coords
          setPanelData({
            ...nextData,
            report: fallback?.report ?? nextData.report,
            context: fallback?.context ?? nextData.context,
            placeName: nextData.placeName ?? fallback?.placeName ?? null,
            coords: fallbackCoords,
            warning: nextData.warning ?? "Overpass no disponible",
          })
        } else {
          setPanelData(nextData)
          if (nextData.report) {
            lastGoodRef.current = nextData
          }
        }

        if (warnings.length > 0) {
          const toastWarning = warnings.find((item) => {
            const lower = item.toLowerCase()
            return lower.includes("overpass") || lower.includes("ia")
          })
          if (toastWarning) {
            toast.warning(toastWarning)
          }
        }
        if (!data.aiReport && data.fallbackReport) {
          toast("IA no disponible. Mostrando informe alternativo.")
        }

        setStatus("ready")
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setErrorMessage("No se pudo analizar el lugar.")
        setStatus("error")
      }
    },
    [toast]
  )

  useEffect(() => {
    if (autoAnalyzeRef.current) return
    if (typeof initialLat !== "number" || typeof initialLon !== "number") {
      return
    }
    const nextRadius =
      typeof initialRadius === "number" && initialRadius > 0
        ? Math.round(initialRadius)
        : radiusMeters
    const normalizedRadius = RADIUS_OPTIONS.includes(nextRadius)
      ? nextRadius
      : radiusMeters
    autoAnalyzeRef.current = true
    setRadiusMeters(normalizedRadius)
    setPosition([initialLat, initialLon])
    analyzePlace(initialLat, initialLon, normalizedRadius)
    mapRef.current?.setView([initialLat, initialLon], 14, { animate: false })
  }, [initialLat, initialLon, initialRadius, radiusMeters, analyzePlace])

  async function handleSearch() {
    if (!searchValue.trim()) return
    setSearchLoading(true)
    toast("Buscando direccion...")

    try {
      const res = await fetch("/api/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direccion: searchValue }),
      })

      if (!res.ok) {
        throw new Error("No se pudo geocodificar")
      }

      const data = (await res.json()) as {
        ok: boolean
        result?: { lat: number; lon: number; display_name: string }
      }

      if (!data.ok || !data.result) {
        throw new Error("Sin resultados")
      }

      const { lat, lon, display_name } = data.result
      setPosition([lat, lon])
      mapRef.current?.flyTo([lat, lon], 14, { animate: true })
      analyzePlace(lat, lon, radiusMeters)
      toast.success(`Resultado: ${display_name}`)
    } catch (err) {
      toast.error("No se encontro la direccion")
    } finally {
      setSearchLoading(false)
    }
  }

  function handleRadiusChange(nextRadius: number) {
    setRadiusMeters(nextRadius)
    if (position) {
      analyzePlace(position[0], position[1], nextRadius)
    }
  }

  function handleCenter() {
    const target =
      position ??
      (panelData.coords ? [panelData.coords.lat, panelData.coords.lon] : null)
    if (!target || !mapRef.current) return
    mapRef.current.flyTo(target, mapRef.current.getZoom(), { animate: true })
  }

  async function handleCopyCoords() {
    if (!position) return
    const text = `${position[0].toFixed(5)}, ${position[1].toFixed(5)}`
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Coordenadas copiadas")
    } catch (error) {
      toast.error("No se pudo copiar")
    }
  }

  function handleClear() {
    abortRef.current?.abort()
    setPosition(null)
    setStatus("idle")
    setErrorMessage(null)
    setPanelData({
      placeName: null,
      report: null,
      aiReport: null,
      context: null,
      warning: null,
      coords: null,
      requestId: null,
      status: null,
    overpassOk: null,
    overpassError: null,
    floodOk: null,
    floodError: null,
    floodStatus: null,
  })
  }

  function handleToggleLayer(layer: LayerKey, next: boolean) {
    setLayers((prev) => {
      if (layer === "clc" || layer === "flood") {
        return { ...prev, [layer]: next }
      }

      const nextState = {
        ...prev,
        osm: false,
        ign: false,
        pnoa: false,
        [layer]: next,
      }

      if (!nextState.osm && !nextState.ign && !nextState.pnoa) {
        nextState.osm = true
      }

      return nextState
    })
  }

  const overpassBadge = useMemo(() => {
    if (panelData.overpassOk === null) {
      return { label: "Overpass en espera", tone: "muted" as const }
    }
    if (panelData.overpassOk) {
      return { label: "Overpass OK", tone: "ok" as const }
    }
    return { label: "Overpass no disponible", tone: "error" as const }
  }, [panelData.overpassOk])

  const aiBadge = useMemo(() => {
    if (status === "idle") {
      return { label: "IA en espera", tone: "muted" as const }
    }
    if (panelData.aiReport) {
      return { label: "IA OK", tone: "ok" as const }
    }
    if (panelData.report) {
      return { label: "IA alternativa", tone: "warn" as const }
    }
    return { label: "IA sin datos", tone: "error" as const }
  }, [panelData.aiReport, panelData.report, status])

  const badgeToneClass = (tone: "ok" | "warn" | "error" | "muted") =>
    cn(
      "border",
      tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-700",
      tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
      tone === "error" && "border-rose-200 bg-rose-50 text-rose-700",
      tone === "muted" && "border-slate-200 bg-slate-50 text-slate-600"
    )

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f3ef]">
      <header className="border-b bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white">
              IA
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">IA Maps</div>
              <div className="text-xs text-muted-foreground">
                Analisis geoespacial con fuentes oficiales
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge className={badgeToneClass(overpassBadge.tone)}>
              {overpassBadge.label}
            </Badge>
            <Badge className={badgeToneClass(aiBadge.tone)}>{aiBadge.label}</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-slate-900">
                Buscar direccion
              </div>
              <SearchBar
                value={searchValue}
                onChange={setSearchValue}
                onSearch={handleSearch}
                loading={searchLoading}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Radio
                </span>
                <ToggleGroup
                  type="single"
                  value={String(radiusMeters)}
                  onValueChange={(value) => {
                    const parsed = Number(value)
                    if (!Number.isNaN(parsed)) {
                      handleRadiusChange(parsed)
                    }
                  }}
                  variant="outline"
                  size="sm"
                  spacing={0}
                >
                  {RADIUS_OPTIONS.map((option) => (
                    <ToggleGroupItem key={option} value={String(option)}>
                      {option} m
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <div className="ml-auto flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyCoords}
                        disabled={!position}
                      >
                        <Copy className="size-4" />
                        Copiar coords
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copiar coordenadas</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCenter}
                        disabled={!position}
                      >
                        <LocateFixed className="size-4" />
                        Recentrar
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Recentrar mapa</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClear}
                        disabled={!position && status === "idle"}
                      >
                        <Eraser className="size-4" />
                        Limpiar
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Limpiar seleccion</TooltipContent>
                  </Tooltip>

                  {status === "loading" && (
                    <Badge className="border-blue-200 bg-blue-50 text-blue-700">
                      <Loader2 className="size-3 animate-spin" />
                      Analizando...
                    </Badge>
                  )}
                </div>
              </div>

              <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-xl border bg-muted/20">
                <MapContainer
                  center={initialCenter}
                  zoom={12}
                  className={cn(
                    "h-full w-full",
                    status === "loading" ? "cursor-wait" : "cursor-crosshair"
                  )}
                  ref={mapRef}
                >
                  {layers.osm && (
                    <TileLayer
                      attribution="(c) OpenStreetMap contributors"
                      url={OSM_TILE_URL}
                    />
                  )}

                  {layers.ign && (
                    <WMSTileLayer
                      url={IGN_WMS_URL}
                      layers={IGN_WMS_LAYER}
                      format="image/png"
                      transparent={false}
                    />
                  )}

                  {layers.pnoa && (
                    <WMSTileLayer
                      url={PNOA_WMS_URL}
                      layers={PNOA_WMS_LAYER}
                      format="image/jpeg"
                      transparent={false}
                    />
                  )}

                  {layers.clc && (
                    <WMSTileLayer
                      url={CLC_WMS_URL}
                      layers={CLC_WMS_LAYER}
                      format="image/png"
                      transparent
                      opacity={0.6}
                    />
                  )}

                  {layers.flood && (
                    <WMSTileLayer
                      url={FLOOD_WMS_URL}
                      layers={FLOOD_WMS_LAYER}
                      format="image/png"
                      transparent
                      opacity={0.55}
                    />
                  )}

                  <ClickHandler
                    onClick={(nextLat, nextLon) => {
                      setPosition([nextLat, nextLon])
                      mapRef.current?.flyTo([nextLat, nextLon], 14, {
                        animate: true,
                      })
                      analyzePlace(nextLat, nextLon, radiusMeters)
                    }}
                  />

                  {position && (
                    <>
                      <Circle
                        center={position}
                        radius={radiusMeters}
                        pathOptions={{
                          color: "#0f766e",
                          fillColor: "#99f6e4",
                          fillOpacity: 0.2,
                        }}
                      />
                      <Marker position={position}>
                        <LeafletTooltip direction="top" offset={[0, -10]}>
                          Punto analizado
                        </LeafletTooltip>
                      </Marker>
                    </>
                  )}
                </MapContainer>

                {!position && status === "idle" && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full border bg-white/80 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                      <MapPin className="mr-1 inline-block size-3" />
                      Haz click para analizar un punto
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 lg:sticky lg:top-4 lg:h-[calc(100vh-96px)] lg:w-[420px] lg:flex-none lg:self-start lg:overflow-hidden">
            <RightPanel
              status={status}
              report={panelData.report}
              aiReport={panelData.aiReport}
              context={panelData.context}
              placeName={panelData.placeName}
              coords={panelData.coords}
              radius={panelData.context?.radius_m ?? radiusMeters}
              warning={panelData.warning}
              statusCode={panelData.status}
              errorMessage={errorMessage}
              requestId={panelData.requestId}
              floodOk={panelData.floodOk}
              floodError={panelData.floodError}
              floodStatus={panelData.floodStatus}
              layers={layers}
              onToggleLayer={handleToggleLayer}
              onRetry={() => {
                const target =
                  position ??
                  (panelData.coords
                    ? [panelData.coords.lat, panelData.coords.lon]
                    : null)
                if (!target) return
                analyzePlace(target[0], target[1], radiusMeters)
              }}
            />
          </div>
        </div>
      </main>
    </div>
  )
}
