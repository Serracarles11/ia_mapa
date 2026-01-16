"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip as LeafletTooltip,
  WMSTileLayer,
  useMapEvent,
} from "react-leaflet"
import L, { type LeafletMouseEvent } from "leaflet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { getCamsLayerConfig, getEfasLayerConfig } from "@/lib/copernicus"
import { buildComparisonSummary } from "@/lib/report/comparePlaces"
import AircraftLayer, { type AircraftStatus } from "@/components/AircraftLayer"
import {
  ArrowLeftRight,
  Copy,
  Eraser,
  Loader2,
  LocateFixed,
  MapPin,
  Plane,
  PanelRight,
  ShieldAlert,
  Wind,
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
const MITECO_FLOOD_WMS_URL =
  "https://servicios.mapama.gob.es/arcgis/services/Agua/Riesgo/MapServer/WMSServer"
const MITECO_FLOOD_WMS_LAYER = "AreaImp_100"

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
  flood_status?: "OK" | "DOWN" | "VISUAL_ONLY"
  air_ok?: boolean
  air_error?: string | null
  air_status?: "OK" | "DOWN" | "VISUAL_ONLY"
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
  floodStatus: "OK" | "DOWN" | "VISUAL_ONLY" | null
  airOk: boolean | null
  airError: string | null
  airStatus: "OK" | "DOWN" | "VISUAL_ONLY" | null
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
  const [compareMode, setCompareMode] = useState(false)
  const [compareStatus, setCompareStatus] = useState<
    "idle" | "loading" | "error"
  >("idle")
  const [compareAiStatus, setCompareAiStatus] = useState<
    "idle" | "loading" | "error"
  >("idle")
  const [comparePoint, setComparePoint] = useState<[number, number] | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [aircraftStatus, setAircraftStatus] = useState<AircraftStatus>({
    state: "idle",
    count: 0,
  })
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
    airOk: null,
    airError: null,
    airStatus: null,
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
    air: false,
    aircraft: false,
  })

  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const compareAbortRef = useRef<AbortController | null>(null)
  const compareRequestIdRef = useRef(0)
  const lastGoodRef = useRef<PanelData | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const autoAnalyzeRef = useRef(false)
  const efasConfig = useMemo(() => getEfasLayerConfig(), [])
  const camsConfig = useMemo(() => getCamsLayerConfig(), [])

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
      compareAbortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      setCompareMode(false)
      setCompareStatus("idle")
      setCompareError(null)
      setCompareAiStatus("idle")
      setComparePoint(null)

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
        airOk: null,
        airError: null,
        airStatus: null,
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
          data.contextData?.flood_risk?.status ??
          (floodOk === null ? null : floodOk ? "OK" : "DOWN")
        const airOk =
          typeof data.air_ok === "boolean"
            ? data.air_ok
            : data.contextData?.air_quality?.ok ?? null
        const airError =
          typeof data.air_error === "string"
            ? data.air_error
            : data.contextData?.air_quality?.ok
              ? null
              : data.contextData?.air_quality?.details ?? null
        const airStatus =
          data.air_status ??
          data.contextData?.air_quality?.status ??
          (airOk === null ? null : airOk ? "OK" : "DOWN")

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
          airOk,
          airError,
          airStatus,
        }

        if (responseStatus === "OVERPASS_DOWN") {
          const fallback = lastGoodRef.current
          const nextReport = nextData.report ?? fallback?.report ?? null
          const nextContext = nextData.context ?? fallback?.context ?? null
          const fallbackCoords = nextContext?.center
            ? { lat: nextContext.center.lat, lon: nextContext.center.lon }
            : nextData.coords
          setPanelData({
            ...nextData,
            report: nextReport,
            context: nextContext,
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
            return lower.includes("overpass")
          })
          if (toastWarning) {
            toast.warning(toastWarning)
          }
        }

        setStatus("ready")
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (requestId !== requestIdRef.current) return
        setErrorMessage("No se pudo analizar el lugar.")
        setStatus("error")
      }
    },
    []
  )

  async function handleCompareSelection(lat: number, lon: number) {
    if (!panelData.context) {
      setCompareMode(false)
      setCompareError("Selecciona un punto base antes de comparar.")
      return
    }

    compareAbortRef.current?.abort()
    const controller = new AbortController()
    compareAbortRef.current = controller
    const requestId = compareRequestIdRef.current + 1
    compareRequestIdRef.current = requestId

    setCompareStatus("loading")
    setCompareError(null)
    setCompareAiStatus("idle")
    setComparePoint([lat, lon])

    try {
      const res = await fetch("/api/analyze-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          center: { lat, lon },
          radius_m: radiusMeters,
          request_id: requestId,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || "No se pudo comparar.")
      }

      const data = (await res.json()) as AnalyzeResponse
      if (requestId !== compareRequestIdRef.current) return
      if (!data.ok || !data.contextData) {
        throw new Error(data.error || "No se pudo comparar.")
      }

      const summary = buildComparisonSummary(
        panelData.context,
        data.contextData,
        panelData.placeName,
        data.placeName ?? null
      )
      const baseReport = panelData.report
      const targetReport = data.aiReport ?? data.fallbackReport ?? null
      const enrichMetrics = (metrics: typeof summary.base_metrics, report: AiReport | null) =>
        metrics
          ? {
              ...metrics,
              summary: report?.descripcion_zona ?? null,
              recommendation: report?.recomendacion_final ?? null,
            }
          : metrics

      const enrichedSummary = {
        ...summary,
        base_metrics: enrichMetrics(summary.base_metrics, baseReport),
        target_metrics: enrichMetrics(summary.target_metrics, targetReport),
        ai_opinion: null,
      }

      setPanelData((prev) => ({
        ...prev,
        context: prev.context
          ? { ...prev.context, comparison: enrichedSummary }
          : prev.context,
      }))
      setCompareStatus("idle")
      setCompareMode(false)
      toast.success("Comparacion lista")

      if (enrichedSummary.base_metrics && enrichedSummary.target_metrics) {
        setCompareAiStatus("loading")
        try {
          const aiRes = await fetch("/api/compare-places", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base: {
                name: enrichedSummary.base.name,
                coords: enrichedSummary.base.coords,
                radius_m: enrichedSummary.base.radius_m,
                metrics: enrichedSummary.base_metrics,
              },
              target: {
                name: enrichedSummary.target.name,
                coords: enrichedSummary.target.coords,
                radius_m: enrichedSummary.target.radius_m,
                metrics: enrichedSummary.target_metrics,
              },
            }),
          })

          if (requestId !== compareRequestIdRef.current) return
          if (aiRes.ok) {
            const aiData = (await aiRes.json()) as { opinion?: string }
            if (aiData.opinion) {
              setPanelData((prev) => ({
                ...prev,
                context: prev.context?.comparison
                  ? {
                      ...prev.context,
                      comparison: {
                        ...prev.context.comparison,
                        ai_opinion: aiData.opinion,
                      },
                    }
                  : prev.context,
              }))
              setCompareAiStatus("idle")
            } else {
              setCompareAiStatus("error")
            }
          } else {
            setCompareAiStatus("error")
          }
        } catch {
          if (requestId !== compareRequestIdRef.current) return
          setCompareAiStatus("error")
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      if (requestId !== compareRequestIdRef.current) return
      setCompareStatus("error")
      setCompareMode(false)
      setCompareError("No se pudo comparar los sitios.")
      setCompareAiStatus("error")
      toast.error("No se pudo comparar")
    }
  }

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

  const handleSearch = useCallback(async () => {
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
    } catch {
      toast.error("No se encontro la direccion")
    } finally {
      setSearchLoading(false)
    }
  }, [searchValue, radiusMeters, analyzePlace])

  const handleSearchValueChange = useCallback((next: string) => {
    setSearchValue(next)
  }, [])

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
    } catch {
      toast.error("No se pudo copiar")
    }
  }

  function handleClear() {
    abortRef.current?.abort()
    compareAbortRef.current?.abort()
    setPosition(null)
    setStatus("idle")
    setErrorMessage(null)
    setCompareMode(false)
    setCompareStatus("idle")
    setCompareError(null)
    setCompareAiStatus("idle")
    setComparePoint(null)
    setAircraftStatus({ state: "idle", count: 0 })
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
      airOk: null,
      airError: null,
      airStatus: null,
    })
  }

  const handleToggleLayer = useCallback((layer: LayerKey, next: boolean) => {
    setLayers((prev) => {
      if (
        layer === "clc" ||
        layer === "flood" ||
        layer === "air" ||
        layer === "aircraft"
      ) {
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
  }, [])

  const handleAircraftStatusChange = useCallback((next: AircraftStatus) => {
    setAircraftStatus(next)
    if (next.state === "error") {
      toast.warning(next.notice || "Radar ADS-B no disponible.")
    }
  }, [])

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
      return { label: "Informe en espera", tone: "muted" as const }
    }
    if (status === "loading") {
      return { label: "Generando informe", tone: "muted" as const }
    }
    if (panelData.aiReport) {
      return { label: "IA OK", tone: "ok" as const }
    }
    if (panelData.report) {
      return { label: "Informe OK", tone: "ok" as const }
    }
    return { label: "Informe pendiente", tone: "muted" as const }
  }, [panelData.aiReport, panelData.report, status])

  const floodLayerDisabled =
    !panelData.context || panelData.floodStatus === "DOWN"
  const airLayerDisabled =
    !panelData.context || panelData.airStatus === "DOWN"
  const canCompare = Boolean(panelData.context) && status === "ready"
  const comparison = panelData.context?.comparison ?? null
  const comparisonTargetLabel = comparison
    ? comparison.target.name ||
      `${comparison.target.coords.lat.toFixed(4)}, ${comparison.target.coords.lon.toFixed(4)}`
    : null
  const panelLat = panelData.coords?.lat ?? null
  const panelLon = panelData.coords?.lon ?? null
  const positionLat = position?.[0] ?? null
  const positionLon = position?.[1] ?? null
  const aircraftCenter = useMemo(() => {
    if (panelLat != null && panelLon != null) {
      return { lat: panelLat, lon: panelLon }
    }
    if (positionLat != null && positionLon != null) {
      return { lat: positionLat, lon: positionLon }
    }
    return null
  }, [panelLat, panelLon, positionLat, positionLon])

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

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-4 py-4 min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-slate-900">
                Buscar direccion
              </div>
              <SearchBar
                value={searchValue}
                onChange={handleSearchValueChange}
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
                        variant={compareMode ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          if (!canCompare) return
                          if (compareMode) {
                            setCompareMode(false)
                            setCompareStatus("idle")
                            setCompareAiStatus("idle")
                            setComparePoint(null)
                            return
                          }
                          setPanelData((prev) => ({
                            ...prev,
                            context: prev.context
                              ? { ...prev.context, comparison: null }
                              : prev.context,
                          }))
                          setCompareMode(true)
                          setCompareError(null)
                          setCompareAiStatus("idle")
                          setComparePoint(null)
                          toast("Selecciona el segundo punto para comparar.")
                        }}
                        disabled={!canCompare || compareStatus === "loading"}
                      >
                        <ArrowLeftRight className="size-4" />
                        {compareMode ? "Cancelar" : "Comparar"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Selecciona un segundo punto para comparar
                    </TooltipContent>
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

            {(compareMode ||
              comparison ||
              compareStatus === "loading" ||
              compareAiStatus === "loading" ||
              compareAiStatus === "error" ||
              compareError) && (
              <div className="mt-3 space-y-2">
                {compareMode && (
                  <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    Modo comparacion activo. Selecciona el segundo punto.
                  </div>
                )}
                {compareStatus === "loading" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Comparando sitios...
                  </div>
                )}
                {compareAiStatus === "loading" && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                    IA comparando lugares...
                  </div>
                )}
                {compareAiStatus === "error" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    No se pudo generar la comparacion IA.
                  </div>
                )}
                {compareError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    {compareError}
                  </div>
                )}
                {comparison && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    <div>
                      <div className="font-semibold">
                        Comparando con {comparisonTargetLabel || "punto comparado"}
                      </div>
                      <div className="text-[11px] text-emerald-900/80">
                        Radio: {comparison.target.radius_m} m
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPanelData((prev) => ({
                          ...prev,
                          context: prev.context
                            ? { ...prev.context, comparison: null }
                            : prev.context,
                        }))
                        setCompareStatus("idle")
                        setCompareError(null)
                        setCompareAiStatus("idle")
                        setComparePoint(null)
                      }}
                    >
                      Quitar comparacion
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-xl border bg-muted/20">
              <div className="absolute right-3 top-3 z-[400] flex flex-col gap-2">
                <Card className="w-48 border bg-white/95 p-2 text-xs shadow-sm backdrop-blur">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <PanelRight className="size-3" />
                    Controles rapidos
                  </div>
                  <div className="grid gap-2">
                    <Button
                      variant={layers.flood ? "default" : "outline"}
                      size="sm"
                      className="h-8 justify-start text-xs"
                      onClick={() => handleToggleLayer("flood", !layers.flood)}
                      disabled={floodLayerDisabled}
                    >
                      <ShieldAlert className="size-3" />
                      Inundacion
                    </Button>
                    <Button
                      variant={layers.air ? "default" : "outline"}
                      size="sm"
                      className="h-8 justify-start text-xs"
                      onClick={() => handleToggleLayer("air", !layers.air)}
                      disabled={airLayerDisabled}
                    >
                      <Wind className="size-3" />
                      Aire
                    </Button>
                    <Button
                      variant={layers.aircraft ? "default" : "outline"}
                      size="sm"
                      className="h-8 justify-start text-xs"
                      onClick={() =>
                        handleToggleLayer("aircraft", !layers.aircraft)
                      }
                    >
                      <Plane className="size-3" />
                      Aviones
                    </Button>
                    <Button
                      variant={layers.clc ? "default" : "outline"}
                      size="sm"
                      className="h-8 justify-start text-xs"
                      onClick={() => handleToggleLayer("clc", !layers.clc)}
                    >
                      CLC
                    </Button>
                    <Button
                      variant={layers.pnoa ? "default" : "outline"}
                      size="sm"
                      className="h-8 justify-start text-xs"
                      onClick={() => handleToggleLayer("pnoa", !layers.pnoa)}
                    >
                      Satelite
                    </Button>
                  </div>
                </Card>
                {layers.flood && (
                  <Card className="w-48 border bg-white/95 p-2 text-[11px] shadow-sm backdrop-blur">
                    <div className="font-semibold">Leyenda inundacion</div>
                    <div className="mt-1 text-muted-foreground">
                      Zonas potencialmente inundables (EFAS/MITECO).
                    </div>
                  </Card>
                )}
                {layers.air && (
                  <Card className="w-48 border bg-white/95 p-2 text-[11px] shadow-sm backdrop-blur">
                    <div className="font-semibold">Leyenda aire</div>
                    <div className="mt-1 text-muted-foreground">
                      Capa CAMS (PM2.5). Visualizacion sin valor puntual si no
                      hay muestreo.
                    </div>
                  </Card>
                )}
                {layers.aircraft && (
                  <Card className="w-48 border bg-white/95 p-2 text-[11px] shadow-sm backdrop-blur">
                    <div className="font-semibold">Aviones en tiempo real</div>
                    <div className="mt-1 text-muted-foreground">
                      {aircraftStatus.state === "loading"
                        ? "Actualizando trafico aereo..."
                        : aircraftStatus.state === "error"
                          ? aircraftStatus.notice || "No hay datos disponibles."
                          : `${aircraftStatus.count} aviones detectados`}
                    </div>
                    {aircraftStatus.mode === "demo" && (
                      <div className="mt-1 text-[10px] text-amber-700">
                        Modo demo
                      </div>
                    )}
                    {aircraftStatus.source && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Fuente: {aircraftStatus.source}
                      </div>
                    )}
                    {aircraftStatus.notice && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {aircraftStatus.notice}
                      </div>
                    )}
                  </Card>
                )}
              </div>
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
                      url={
                        panelData.context?.flood_risk?.source === "MITECO"
                          ? MITECO_FLOOD_WMS_URL
                          : efasConfig.baseUrl
                      }
                      layers={
                        panelData.context?.flood_risk?.source === "MITECO"
                          ? MITECO_FLOOD_WMS_LAYER
                          : efasConfig.layer
                      }
                      format="image/png"
                      transparent
                      opacity={0.55}
                    />
                  )}

                  {layers.air && (
                    <WMSTileLayer
                      url={camsConfig.baseUrl}
                      layers={camsConfig.layer}
                      format="image/png"
                      transparent
                      opacity={0.5}
                    />
                  )}

                  <ClickHandler
                    onClick={(nextLat, nextLon) => {
                      if (compareMode) {
                        mapRef.current?.flyTo([nextLat, nextLon], 14, {
                          animate: true,
                        })
                        handleCompareSelection(nextLat, nextLon)
                        return
                      }

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

                  {comparePoint && (
                    <Marker position={comparePoint}>
                      <LeafletTooltip direction="top" offset={[0, -10]}>
                        Punto comparado
                      </LeafletTooltip>
                    </Marker>
                  )}

                  {comparison && (
                    <>
                      <Polyline
                        positions={[
                          [comparison.base.coords.lat, comparison.base.coords.lon],
                          [comparison.target.coords.lat, comparison.target.coords.lon],
                        ]}
                        pathOptions={{ color: "#f59e0b", dashArray: "4 6" }}
                      />
                      <Circle
                        center={[
                          comparison.target.coords.lat,
                          comparison.target.coords.lon,
                        ]}
                        radius={comparison.target.radius_m}
                        pathOptions={{
                          color: "#f59e0b",
                          fillColor: "#fde68a",
                          fillOpacity: 0.2,
                        }}
                      />
                    </>
                  )}

                  <AircraftLayer
                    enabled={layers.aircraft}
                    center={aircraftCenter}
                    radius_m={radiusMeters}
                    onStatusChange={handleAircraftStatusChange}
                  />
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

          <div className="flex min-h-0 flex-1 lg:sticky lg:top-4 lg:h-[calc(100vh-96px)] lg:w-[420px] lg:flex-none lg:self-start">
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
              airOk={panelData.airOk}
              airError={panelData.airError}
              airStatus={panelData.airStatus}
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
