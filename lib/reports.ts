import "server-only"
import { getSupabaseAdmin } from "@/lib/supabase"

// Shared server-side helpers for ai_reports.
export type AiReportInsert = {
  place_name: string | null
  lat: number
  lon: number
  category: string | null
  report: unknown
}

export async function saveAiReport(payload: AiReportInsert) {
  const supabaseAdmin = getSupabaseAdmin()
  const { error } = await supabaseAdmin.from("ai_reports").insert(payload)
  if (error) {
    throw error
  }
}

export async function getRecentAiReports(limit = 20) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from("ai_reports")
    .select("id, place_name, lat, lon, category, report, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  return data ?? []
}
