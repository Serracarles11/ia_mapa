"use client"

import dynamic from "next/dynamic"

type MapProps = {
  initialLat?: number | null
  initialLon?: number | null
  initialRadius?: number | null
}

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
      Cargando mapa...
    </div>
  ),
})

export default function Map({ initialLat, initialLon, initialRadius }: MapProps) {
  return (
    <MapInner
      initialLat={initialLat}
      initialLon={initialLon}
      initialRadius={initialRadius}
    />
  )
}
