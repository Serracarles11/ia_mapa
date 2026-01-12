"use client"

import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { type AiReport, type ContextData } from "@/lib/types"
import ChatView from "@/components/ChatView"
import LayerControls, {
  type LayerKey,
  type LayerState,
} from "@/components/LayerControls"
import ReportView from "@/components/ReportView"

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
  floodStatus: "OK" | "DOWN" | null
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
  layers,
  onToggleLayer,
  onRetry,
}: RightPanelProps) {
  const floodServiceOk =
    typeof floodOk === "boolean"
      ? floodOk
      : context?.flood_risk?.ok ?? null
  const floodDisabled = !context || floodServiceOk === false
  const floodHint = !context
    ? "Selecciona un punto para habilitar la capa."
    : floodServiceOk === false
      ? floodError || "Servicio de inundacion no disponible."
      : "Capa oficial de inundacion (WMS)."

  return (
    <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-0 bg-white/90 shadow-sm backdrop-blur">
      <Tabs defaultValue="informe" className="flex h-full min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full grid-cols-3 rounded-none border-b bg-white">
          <TabsTrigger value="informe">Informe</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="capas">Capas</TabsTrigger>
        </TabsList>

        <TabsContent value="informe" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto p-4">
            <ReportView
              status={status}
              report={report}
              aiReport={aiReport}
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

        <TabsContent value="capas" className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto p-4">
            <LayerControls
              layers={layers}
              onToggle={onToggleLayer}
              floodDisabled={floodDisabled}
              floodHint={floodHint}
              floodStatus={floodStatus}
            />
            <div className="mt-4 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
              Activa o desactiva capas para comparar base cartografica y usos del suelo.
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  )
}
