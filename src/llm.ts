export type Provider = 'deepseek' | 'ark' | 'openai' | 'anthropic' | 'aihubmix'

interface LLMCallOptions {
  provider: Provider
  model: string
  systemPrompt: string
  userMessage: string
  jsonMode?: boolean
}

interface LLMResponse {
  content: string
}

type StreamChunkCallback = (chunk: string) => void

async function streamOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  jsonMode: boolean,
  onChunk: StreamChunkCallback
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
    stream: true,
  }

  if (jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error (${baseUrl}): ${response.status} - ${error}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No readable stream from API')

  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          fullContent += delta
          onChunk(delta)
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return { content: fullContent }
}

async function streamAnthropic(
  model: string,
  systemPrompt: string,
  userMessage: string,
  onChunk: StreamChunkCallback
): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${error}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No readable stream from Anthropic')

  const decoder = new TextDecoder()
  let fullContent = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)

      try {
        const parsed = JSON.parse(data)
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullContent += parsed.delta.text
          onChunk(parsed.delta.text)
        }
      } catch {
        // skip
      }
    }
  }

  return { content: fullContent }
}

async function callAnthropic(
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${error}`)
  }

  const data = await response.json() as { content: { text: string }[] }
  return { content: data.content[0].text }
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  jsonMode: boolean
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
  }

  if (jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error (${baseUrl}): ${response.status} - ${error}`)
  }

  const data = await response.json() as { choices: { message: { content: string } }[] }
  return { content: data.choices[0].message.content }
}

function getProviderConfig(provider: Provider): { baseUrl: string; apiKey: string } {
  switch (provider) {
    case 'deepseek': {
      const apiKey = process.env.DEEPSEEK_API_KEY
      if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set')
      return { baseUrl: 'https://api.deepseek.com/v1', apiKey }
    }
    case 'ark': {
      const apiKey = process.env.ARK_API_KEY
      if (!apiKey) throw new Error('ARK_API_KEY is not set')
      return { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey }
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
      return { baseUrl: 'https://api.openai.com/v1', apiKey }
    }
    case 'aihubmix': {
      const apiKey = process.env.AIHUBMIX_API_KEY
      if (!apiKey) throw new Error('AIHUBMIX_API_KEY is not set')
      return { baseUrl: 'https://aihubmix.com/v1', apiKey }
    }
    default:
      throw new Error(`No config for provider: ${provider}`)
  }
}

export async function callLLM(options: LLMCallOptions): Promise<LLMResponse> {
  const { provider, model, systemPrompt, userMessage, jsonMode } = options

  if (provider === 'anthropic') {
    return callAnthropic(model, systemPrompt, userMessage)
  }

  const config = getProviderConfig(provider)
  return callOpenAICompatible(config.baseUrl, config.apiKey, model, systemPrompt, userMessage, jsonMode ?? false)
}

export async function callLLMStreaming(
  options: LLMCallOptions,
  onChunk: StreamChunkCallback
): Promise<LLMResponse> {
  const { provider, model, systemPrompt, userMessage, jsonMode } = options

  if (provider === 'anthropic') {
    return streamAnthropic(model, systemPrompt, userMessage, onChunk)
  }

  const config = getProviderConfig(provider)
  return streamOpenAICompatible(config.baseUrl, config.apiKey, model, systemPrompt, userMessage, jsonMode ?? false, onChunk)
}

export interface AgentConfig {
  provider: Provider
  model: string
}

export function getAgentAConfig(): AgentConfig {
  return {
    provider: (process.env.AGENT_A_PROVIDER as Provider) || 'deepseek',
    model: process.env.AGENT_A_MODEL || 'deepseek-chat',
  }
}

export function getAgentBConfig(): AgentConfig {
  return {
    provider: (process.env.AGENT_B_PROVIDER as Provider) || 'ark',
    model: process.env.AGENT_B_MODEL || process.env.ARK_MODEL || 'doubao-seed-1-8-251228',
  }
}

export function getJudgeConfig(): AgentConfig {
  return {
    provider: (process.env.JUDGE_PROVIDER as Provider) || 'deepseek',
    model: process.env.JUDGE_MODEL || 'deepseek-chat',
  }
}
