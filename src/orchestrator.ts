import type { AgentResponse, JudgeSummary, DiscussionRound, DiscussionResult } from './types'
import { callLLM, callLLMStreaming, getAgentAConfig, getAgentBConfig, getJudgeConfig, type Provider } from './llm'
import {
  AGENT_A_SYSTEM_PROMPT,
  AGENT_B_SYSTEM_PROMPT,
  JUDGE_C_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildFirstRoundAgentMessage,
  buildSubsequentRoundAgentAMessage,
  buildSubsequentRoundAgentBMessage,
  buildJudgeMessage,
  buildSummaryMessage,
} from './prompts'

function supportsJsonMode(provider: Provider): boolean {
  return provider !== 'anthropic'
}

const DEFAULT_MAX_ROUNDS = 3
const JSON_SEPARATOR = '---JSON_DATA---'

function splitResponse(raw: string): { markdown: string; jsonStr: string } {
  const idx = raw.indexOf(JSON_SEPARATOR)
  if (idx === -1) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{')) {
      return { markdown: '', jsonStr: trimmed }
    }
    return { markdown: trimmed, jsonStr: '' }
  }
  return {
    markdown: raw.slice(0, idx).trim(),
    jsonStr: raw.slice(idx + JSON_SEPARATOR.length).trim(),
  }
}

function parseAgentResponse(raw: string, agent: 'A' | 'B'): AgentResponse {
  const { markdown, jsonStr } = splitResponse(raw)

  if (jsonStr) {
    try {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          agent,
          points: parsed.points || [{ content: markdown || raw, confidence: 'medium' as const }],
          peer_review: parsed.peer_review || undefined,
          raw_text: markdown || parsed.raw_text || raw,
        }
      }
    } catch {
      // fall through
    }
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        agent,
        points: parsed.points || [{ content: raw, confidence: 'medium' as const }],
        peer_review: parsed.peer_review || undefined,
        raw_text: parsed.raw_text || markdown || raw,
      }
    }
  } catch {
    // fall through
  }

  return {
    agent,
    points: [{ content: markdown || raw, confidence: 'medium' as const }],
    raw_text: markdown || raw,
  }
}

function parseJudgeSummary(raw: string, round: number): JudgeSummary {
  const { markdown, jsonStr } = splitResponse(raw)
  const jsonSource = jsonStr || raw

  try {
    const jsonMatch = jsonSource.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        round: parsed.round || round,
        conclusion_level: parsed.conclusion_level === 'L1' ? 'L1' : 'L3',
        status_description: parsed.status_description,
        consensus_points: parsed.consensus_points || [],
        divergence_points: parsed.divergence_points || [],
        next_round_focus: parsed.next_round_focus || null,
        conclusion: parsed.conclusion || markdown || null,
      }
    }
  } catch {
    // fall through
  }

  return {
    round,
    conclusion_level: 'L3',
    consensus_points: [],
    divergence_points: [],
    next_round_focus: null,
    conclusion: markdown || raw,
  }
}

async function generateRoundSummary(
  round: number,
  conclusionLevel: 'L1' | 'L3',
  agentAResponse: string,
  agentBResponse: string,
  previousSummary: string
): Promise<string> {
  const configC = getJudgeConfig()
  try {
    const result = await callLLM({
      provider: configC.provider,
      model: configC.model,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userMessage: buildSummaryMessage(round, conclusionLevel, agentAResponse, agentBResponse, previousSummary),
    })
    return result.content.trim()
  } catch {
    return previousSummary
      ? `${previousSummary}\n第 ${round} 轮：摘要生成失败。`
      : `第 ${round} 轮：摘要生成失败。`
  }
}

export async function runDiscussion(
  question: string,
  maxRounds: number = DEFAULT_MAX_ROUNDS,
  additionalContext?: string,
  onProgress?: (message: string) => void
): Promise<DiscussionResult> {
  const rounds: DiscussionRound[] = []
  const configA = getAgentAConfig()
  const configB = getAgentBConfig()
  const configC = getJudgeConfig()

  const log = (msg: string) => onProgress?.(msg)

  const fullQuestion = additionalContext
    ? `${question}\n\n补充信息：${additionalContext}`
    : question

  let historySummary = ''

  // === Round 1: Parallel ===
  log('第 1 轮：A 和 B 独立分析中...')

  const firstRoundMsg = buildFirstRoundAgentMessage(fullQuestion)

  const [rawA, rawB] = await Promise.all([
    callLLMStreaming(
      {
        provider: configA.provider,
        model: configA.model,
        systemPrompt: AGENT_A_SYSTEM_PROMPT,
        userMessage: firstRoundMsg,
        jsonMode: false,
      },
      () => {}
    ),
    callLLMStreaming(
      {
        provider: configB.provider,
        model: configB.model,
        systemPrompt: AGENT_B_SYSTEM_PROMPT,
        userMessage: firstRoundMsg,
        jsonMode: false,
      },
      () => {}
    ),
  ])

  const responseA = parseAgentResponse(rawA.content, 'A')
  const responseB = parseAgentResponse(rawB.content, 'B')

  log('第 1 轮：裁判评估中...')

  const judgeRaw = await callLLMStreaming(
    {
      provider: configC.provider,
      model: configC.model,
      systemPrompt: JUDGE_C_SYSTEM_PROMPT,
      userMessage: buildJudgeMessage(fullQuestion, '', 1, rawA.content, rawB.content, maxRounds === 1),
      jsonMode: false,
    },
    () => {}
  )

  let summary = parseJudgeSummary(judgeRaw.content, 1)
  rounds.push({ round: 1, agentA: responseA, agentB: responseB, judgeSummary: summary })

  if (summary.conclusion_level === 'L1') {
    log('第 1 轮达成共识，讨论结束。')
    return { status: 'concluded', question, rounds, finalSummary: summary }
  }

  historySummary = await generateRoundSummary(1, 'L3', rawA.content, rawB.content, '')

  // === Rounds 2+: Serial ===
  for (let round = 2; round <= maxRounds; round++) {
    const focus = summary.next_round_focus || '继续讨论未解决的分歧'
    const isLastRound = round === maxRounds

    log(`第 ${round} 轮：A 分析中...`)
    const roundRawA = await callLLMStreaming(
      {
        provider: configA.provider,
        model: configA.model,
        systemPrompt: AGENT_A_SYSTEM_PROMPT,
        userMessage: buildSubsequentRoundAgentAMessage(fullQuestion, historySummary, focus),
        jsonMode: false,
      },
      () => {}
    )
    const roundResponseA = parseAgentResponse(roundRawA.content, 'A')

    log(`第 ${round} 轮：B 分析中...`)
    const roundRawB = await callLLMStreaming(
      {
        provider: configB.provider,
        model: configB.model,
        systemPrompt: AGENT_B_SYSTEM_PROMPT,
        userMessage: buildSubsequentRoundAgentBMessage(fullQuestion, historySummary, roundRawA.content, focus),
        jsonMode: false,
      },
      () => {}
    )
    const roundResponseB = parseAgentResponse(roundRawB.content, 'B')

    log(`第 ${round} 轮：裁判评估中...`)
    const roundJudgeRaw = await callLLMStreaming(
      {
        provider: configC.provider,
        model: configC.model,
        systemPrompt: JUDGE_C_SYSTEM_PROMPT,
        userMessage: buildJudgeMessage(fullQuestion, historySummary, round, roundRawA.content, roundRawB.content, isLastRound),
        jsonMode: false,
      },
      () => {}
    )

    summary = parseJudgeSummary(roundJudgeRaw.content, round)
    rounds.push({ round, agentA: roundResponseA, agentB: roundResponseB, judgeSummary: summary })

    if (summary.conclusion_level === 'L1') {
      log(`第 ${round} 轮达成共识，讨论结束。`)
      return { status: 'concluded', question, rounds, finalSummary: summary }
    }

    if (!isLastRound) {
      historySummary = await generateRoundSummary(round, 'L3', roundRawA.content, roundRawB.content, historySummary)
    }
  }

  log('已达最大轮数，讨论结束。')
  return { status: 'concluded', question, rounds, finalSummary: summary }
}
