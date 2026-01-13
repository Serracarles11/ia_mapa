import "server-only"

export type LlmTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type LlmToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export type LlmRequest = {
  messages: LlmMessage[]
  tools?: LlmTool[]
  temperature?: number
  maxTokens?: number
  responseFormat?: "json_object" | "text"
}

export type LlmResponse = {
  provider: "openai" | "groq" | "ollama"
  message: { content: string | null; tool_calls?: LlmToolCall[] }
}

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
const DEFAULT_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
const DEFAULT_GROQ_MODEL = "llama-3.3-70b"
const DEFAULT_OLLAMA_MODEL = "llama3.1"

export function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY)
}

export function hasGroqKey() {
  return Boolean(process.env.GROQ_API_KEY)
}

export function hasOllama() {
  return Boolean(process.env.OLLAMA_BASE_URL)
}

export async function callLlm(request: LlmRequest): Promise<LlmResponse | null> {
  if (hasOpenAiKey()) {
    return callOpenAi(request)
  }

  if (hasGroqKey()) {
    return callGroq(request)
  }

  if (hasOllama()) {
    return callOllama(request)
  }

  return null
}

async function callOpenAi(request: LlmRequest): Promise<LlmResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
  const tools = request.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  const body: Record<string, unknown> = {
    model,
    messages: request.messages.map(toOpenAiMessage),
    temperature: request.temperature ?? 0.2,
  }

  if (typeof request.maxTokens === "number") {
    body.max_tokens = request.maxTokens
  }

  if (request.responseFormat === "json_object") {
    body.response_format = { type: "json_object" }
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = "auto"
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
      }>
    }

    const message = data.choices?.[0]?.message
    if (!message) return null

    return {
      provider: "openai",
      message: {
        content: message.content ?? null,
        tool_calls: normalizeOpenAiToolCalls(message.tool_calls),
      },
    }
  } catch {
    return null
  }
}

async function callGroq(request: LlmRequest): Promise<LlmResponse | null> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) return null

  const apiUrl = process.env.GROQ_API_URL || DEFAULT_GROQ_API_URL
  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
  const tools = request.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  const body: Record<string, unknown> = {
    model,
    messages: request.messages.map(toOpenAiMessage),
    temperature: request.temperature ?? 0.2,
  }

  if (typeof request.maxTokens === "number") {
    body.max_tokens = request.maxTokens
  }

  if (request.responseFormat === "json_object") {
    body.response_format = { type: "json_object" }
  }

  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = "auto"
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
      }>
    }

    const message = data.choices?.[0]?.message
    if (!message) return null

    return {
      provider: "groq",
      message: {
        content: message.content ?? null,
        tool_calls: normalizeOpenAiToolCalls(message.tool_calls),
      },
    }
  } catch {
    return null
  }
}

type OpenAiToolCall = {
  id?: string
  function?: { name?: string; arguments?: string }
}

function normalizeOpenAiToolCalls(calls?: OpenAiToolCall[]) {
  if (!Array.isArray(calls)) return undefined
  const normalized = calls
    .map((call, index) => {
      const name = call.function?.name
      const args = call.function?.arguments
      if (!name || !args) return null
      const parsed = safeJsonParse(args) ?? {}
      return {
        id: call.id ?? `tool-${index}`,
        name,
        arguments: parsed,
      }
    })
    .filter((item): item is LlmToolCall => Boolean(item))

  return normalized.length > 0 ? normalized : undefined
}

async function callOllama(request: LlmRequest): Promise<LlmResponse | null> {
  const baseUrl = process.env.OLLAMA_BASE_URL
  if (!baseUrl) return null

  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL
  const tools = request.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  const body: Record<string, unknown> = {
    model,
    messages: request.messages.map(toOpenAiMessage),
    stream: false,
    options: {
      temperature: request.temperature ?? 0.2,
    },
  }

  if (tools && tools.length > 0) {
    body.tools = tools
  }

  if (request.responseFormat === "json_object") {
    body.format = "json"
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }
    }

    const message = data.message
    if (!message) return null

    return {
      provider: "ollama",
      message: {
        content: message.content ?? null,
        tool_calls: normalizeOpenAiToolCalls(message.tool_calls),
      },
    }
  } catch {
    return null
  }
}

function toOpenAiMessage(message: LlmMessage) {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: message.content,
    }
  }

  if (message.role === "assistant") {
    const payload: Record<string, unknown> = {
      role: "assistant",
      content: message.content,
    }
    if (message.tool_calls) {
      payload.tool_calls = message.tool_calls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      }))
    }
    return payload
  }

  return {
    role: message.role,
    content: message.content,
  }
}

export function safeJsonParse(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    const start = value.indexOf("{")
    const end = value.lastIndexOf("}")
    if (start === -1 || end === -1 || end <= start) return null
    try {
      return JSON.parse(value.slice(start, end + 1))
    } catch {
      return null
    }
  }
}
