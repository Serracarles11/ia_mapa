import "server-only"

import { type WikidataInfo, type WikidataNearbyItem } from "@/lib/types"

const ENDPOINT =
  process.env.WIKIDATA_SPARQL_ENDPOINT || "https://query.wikidata.org/sparql"
const USER_AGENT =
  process.env.WIKIDATA_USER_AGENT || "ia-maps-app/1.0 (local)"

const CACHE_TTL_MS = 1000 * 60 * 20
const cache = new Map<
  string,
  { expiresAt: number; value: WikidataInfo | null }
>()

type SparqlBinding = Record<string, { type: string; value: string }>

export async function fetchWikidataInfo(
  lat: number,
  lon: number,
  radius_m: number,
  placeName?: string | null
): Promise<WikidataInfo | null> {
  const radiusKm = Math.min(Math.max(radius_m / 1000, 1), 10)
  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusKm.toFixed(2)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  let info = await queryNearby(lat, lon, radiusKm)

  if (!info && placeName) {
    const search = await searchByName(placeName)
    if (search?.id) {
      info = await queryById(search.id)
    }
  }

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: info,
  })

  return info
}

export async function fetchWikidataNearby(
  lat: number,
  lon: number,
  radius_m: number,
  limit = 8
): Promise<WikidataNearbyItem[]> {
  const radiusKm = Math.min(Math.max(radius_m / 1000, 0.5), 8)
  const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusKm.toFixed(2)}:${limit}`
  const cached = nearbyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const query = buildNearbyListQuery(lat, lon, radiusKm, limit)
  const data = await runSparql(query)
  const list = parseNearbyList(data)
  nearbyCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: list,
  })
  return list
}

async function queryNearby(
  lat: number,
  lon: number,
  radiusKm: number
): Promise<WikidataInfo | null> {
  const query = buildNearbyQuery(lat, lon, radiusKm)
  const data = await runSparql(query)
  return parseSparqlResult(data)
}

async function queryById(id: string): Promise<WikidataInfo | null> {
  const query = buildEntityQuery(id)
  const data = await runSparql(query)
  return parseSparqlResult(data)
}

async function searchByName(
  name: string
): Promise<{ id: string; label: string | null } | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const url = new URL("https://www.wikidata.org/w/api.php")
  url.searchParams.set("action", "wbsearchentities")
  url.searchParams.set("format", "json")
  url.searchParams.set("language", "es")
  url.searchParams.set("limit", "1")
  url.searchParams.set("search", trimmed)

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  })

  if (!res.ok) return null
  const data = (await res.json()) as {
    search?: Array<{ id?: string; label?: string }>
  }
  const first = data.search?.[0]
  const id = typeof first?.id === "string" ? first.id : null
  if (!id) return null
  return {
    id,
    label: typeof first?.label === "string" ? first.label : null,
  }
}

async function runSparql(query: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      Accept: "application/sparql-results+json",
      "User-Agent": USER_AGENT,
    },
    body: query,
    cache: "no-store",
  })

  if (!res.ok) return null
  return res.json()
}

function parseSparqlResult(data: unknown): WikidataInfo | null {
  const bindings = extractBindings(data)
  if (!bindings || bindings.length === 0) return null
  const row = bindings[0]

  const id = extractId(row.item?.value)
  if (!id) return null

  const wikidata_url = `https://www.wikidata.org/wiki/${id}`

  const label = row.itemLabel?.value ?? null
  const description = row.itemDescription?.value ?? null
  const distValue = row.dist?.value
  const distParsed = distValue != null ? toNumber(distValue) : null
  const distance_m =
    distParsed != null ? Math.round(distParsed * 1000) : null
  const types = splitPipe(row.types?.value)
  const admin_areas = splitPipe(row.admins?.value)
  const aliases = splitPipe(row.aliases?.value)
  const country = row.country?.value ?? null
  const population = toNumber(row.population?.value)
  const areaRaw = toNumber(row.area?.value)
  const area_km2 = areaRaw ? Math.round((areaRaw / 1_000_000) * 100) / 100 : null
  const elevation_m = toNumber(row.elevation?.value)
  const inception = normalizeDate(row.inception?.value)
  const timezone = row.timezone?.value ?? null
  const website = row.website?.value ?? null
  const image = normalizeImage(row.image?.value)
  const commons_category = row.commons?.value ?? null
  const wikipedia_url = row.article?.value ?? null
  const coordinates = parseWktPoint(row.coord?.value)

  const info: WikidataInfo = {
    id,
    label,
    description,
    distance_m,
    wikipedia_url,
    wikidata_url,
    types,
    admin_areas,
    country,
    population,
    area_km2,
    elevation_m,
    inception,
    timezone,
    website,
    image,
    commons_category,
    aliases,
    coordinates,
    facts: [],
  }

  info.facts = buildFacts(info)
  return info
}

const nearbyCache = new Map<
  string,
  { expiresAt: number; value: WikidataNearbyItem[] }
>()

function parseNearbyList(data: unknown): WikidataNearbyItem[] {
  const bindings = extractBindings(data)
  if (!bindings || bindings.length === 0) return []
  return bindings
    .map((row): WikidataNearbyItem | null => {
      const id = extractId(row.item?.value)
      if (!id) return null
      const wikidata_url = `https://www.wikidata.org/wiki/${id}`
      const distValue = row.dist?.value
      const distParsed = distValue != null ? toNumber(distValue) : null
      const distance_m =
        distParsed != null ? Math.round(distParsed * 1000) : null
      return {
        id,
        label: row.itemLabel?.value ?? null,
        description: row.itemDescription?.value ?? null,
        distance_m,
        wikipedia_url: row.article?.value ?? null,
        wikidata_url,
        types: splitPipe(row.types?.value),
        coordinates: parseWktPoint(row.coord?.value),
      }
    })
    .filter((item): item is WikidataNearbyItem => Boolean(item))
}

function extractBindings(data: unknown): SparqlBinding[] | null {
  if (!data || typeof data !== "object") return null
  const record = data as {
    results?: { bindings?: SparqlBinding[] }
  }
  const bindings = record.results?.bindings
  return Array.isArray(bindings) ? bindings : null
}

function extractId(value?: string): string | null {
  if (!value) return null
  const match = value.match(/Q\d+/)
  return match ? match[0] : null
}

function toNumber(value?: string): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeDate(value?: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().slice(0, 10)
}

function splitPipe(value?: string): string[] {
  if (!value) return []
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseWktPoint(value?: string): { lat: number; lon: number } | null {
  if (!value) return null
  const match = value.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/i)
  if (!match) return null
  const lon = Number(match[1])
  const lat = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

function normalizeImage(value?: string): string | null {
  if (!value) return null
  if (value.startsWith("http")) return value
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    value
  )}`
}

function buildFacts(info: WikidataInfo) {
  const facts: string[] = []
  if (info.types.length > 0) {
    facts.push(`Tipos: ${truncateList(info.types, 6)}`)
  }
  if (info.country) {
    facts.push(`Pais: ${info.country}`)
  }
  if (info.admin_areas.length > 0) {
    facts.push(`Administracion: ${truncateList(info.admin_areas, 5)}`)
  }
  if (info.population) {
    facts.push(`Poblacion: ${formatNumber(info.population)}`)
  }
  if (info.area_km2) {
    facts.push(`Area: ${formatNumber(info.area_km2)} km2`)
  }
  if (info.elevation_m) {
    facts.push(`Elevacion: ${formatNumber(info.elevation_m)} m`)
  }
  if (info.inception) {
    facts.push(`Incepcion: ${formatDate(info.inception)}`)
  }
  if (info.timezone) {
    facts.push(`Zona horaria: ${info.timezone}`)
  }
  if (info.website) {
    facts.push(`Web oficial: ${info.website}`)
  }
  if (info.wikipedia_url) {
    facts.push(`Wikipedia: ${info.wikipedia_url}`)
  }
  if (info.commons_category) {
    facts.push(`Commons: ${info.commons_category}`)
  }
  if (info.aliases.length > 0) {
    facts.push(`Alias: ${truncateList(info.aliases, 6)}`)
  }
  if (info.distance_m != null) {
    facts.push(`Distancia al punto: ${info.distance_m} m`)
  }
  if (info.coordinates) {
    facts.push(
      `Coord. Wikidata: ${info.coordinates.lat.toFixed(5)}, ${info.coordinates.lon.toFixed(5)}`
    )
  }

  return facts
}

function truncateList(items: string[], limit: number) {
  if (items.length <= limit) return items.join(", ")
  return `${items.slice(0, limit).join(", ")} +${items.length - limit}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDate(value: string) {
  if (!value) return value
  const year = value.slice(0, 4)
  return year && /^\d{4}$/.test(year) ? year : value
}

function buildNearbyQuery(lat: number, lon: number, radiusKm: number) {
  return `
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX bd: <http://www.bigdata.com/rdf#>
SELECT ?item ?itemLabel ?itemDescription ?dist ?coord
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT ?adminLabel; separator="|") AS ?admins)
       (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
       (SAMPLE(?countryLabel) AS ?country)
       (SAMPLE(?population) AS ?population)
       (SAMPLE(?area) AS ?area)
       (SAMPLE(?elevation) AS ?elevation)
       (SAMPLE(?inception) AS ?inception)
       (SAMPLE(?timezoneLabel) AS ?timezone)
       (SAMPLE(?website) AS ?website)
       (SAMPLE(?image) AS ?image)
       (SAMPLE(?commons) AS ?commons)
       (SAMPLE(?article) AS ?article)
WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
    bd:serviceParam wikibase:distance ?dist .
  }
  OPTIONAL { ?item wdt:P31 ?type . }
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P131 ?admin . }
  OPTIONAL { ?item wdt:P1082 ?population . }
  OPTIONAL { ?item wdt:P2046 ?area . }
  OPTIONAL { ?item wdt:P2044 ?elevation . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P421 ?timezone . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P373 ?commons . }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER (LANG(?alias) = "es") }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://es.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" . }
}
GROUP BY ?item ?itemLabel ?itemDescription ?dist ?coord
ORDER BY ?dist
LIMIT 1
  `.trim()
}

function buildNearbyListQuery(
  lat: number,
  lon: number,
  radiusKm: number,
  limit: number
) {
  return `
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX bd: <http://www.bigdata.com/rdf#>
SELECT ?item ?itemLabel ?itemDescription ?dist ?coord
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (SAMPLE(?article) AS ?article)
WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radiusKm}" .
    bd:serviceParam wikibase:distance ?dist .
  }
  OPTIONAL { ?item wdt:P31 ?type . }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://es.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" . }
}
GROUP BY ?item ?itemLabel ?itemDescription ?dist ?coord
ORDER BY ?dist
LIMIT ${Math.min(Math.max(limit, 1), 20)}
  `.trim()
}

function buildEntityQuery(id: string) {
  return `
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX bd: <http://www.bigdata.com/rdf#>
SELECT ?item ?itemLabel ?itemDescription ?coord
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT ?adminLabel; separator="|") AS ?admins)
       (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
       (SAMPLE(?countryLabel) AS ?country)
       (SAMPLE(?population) AS ?population)
       (SAMPLE(?area) AS ?area)
       (SAMPLE(?elevation) AS ?elevation)
       (SAMPLE(?inception) AS ?inception)
       (SAMPLE(?timezoneLabel) AS ?timezone)
       (SAMPLE(?website) AS ?website)
       (SAMPLE(?image) AS ?image)
       (SAMPLE(?commons) AS ?commons)
       (SAMPLE(?article) AS ?article)
WHERE {
  VALUES ?item { wd:${id} }
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P31 ?type . }
  OPTIONAL { ?item wdt:P17 ?country . }
  OPTIONAL { ?item wdt:P131 ?admin . }
  OPTIONAL { ?item wdt:P1082 ?population . }
  OPTIONAL { ?item wdt:P2046 ?area . }
  OPTIONAL { ?item wdt:P2044 ?elevation . }
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P421 ?timezone . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P373 ?commons . }
  OPTIONAL { ?item skos:altLabel ?alias . FILTER (LANG(?alias) = "es") }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://es.wikipedia.org/> .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en" . }
}
GROUP BY ?item ?itemLabel ?itemDescription ?coord
LIMIT 1
  `.trim()
}
