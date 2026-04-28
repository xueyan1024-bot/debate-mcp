#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { runDiscussion } from './orchestrator'
import type { DiscussionResult } from './types'

const server = new Server(
  { name: 'debate-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'run_debate',
      description:
        '让两个不同的 AI 模型从不同角度辩论同一个问题，由第三个模型担任裁判，最终给出共识结论或结构化的分歧分析。适合需要多角度深度分析的复杂问题。',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: '要辩论分析的问题',
          },
          max_rounds: {
            type: 'number',
            description: '最多辩论几轮（默认 3，最多 5）',
            default: 3,
          },
          additional_context: {
            type: 'string',
            description: '补充背景信息（可选）',
          },
        },
        required: ['question'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'run_debate') {
    throw new Error(`Unknown tool: ${request.params.name}`)
  }

  const args = request.params.arguments as {
    question: string
    max_rounds?: number
    additional_context?: string
  }

  const maxRounds = Math.min(args.max_rounds ?? 3, 5)
  const progressLines: string[] = []

  let result: DiscussionResult
  try {
    result = await runDiscussion(
      args.question,
      maxRounds,
      args.additional_context,
      (msg) => progressLines.push(msg)
    )
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `辩论过程中出错：${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: formatResult(result, progressLines),
      },
    ],
  }
})

function formatResult(result: DiscussionResult, progressLines: string[]): string {
  const lines: string[] = []

  lines.push(`# 辩论分析：${result.question}`)
  lines.push('')

  // Per-round summaries
  for (const round of result.rounds) {
    const s = round.judgeSummary
    lines.push(`## 第 ${round.round} 轮`)
    lines.push('')
    lines.push(`**A 的观点：** ${round.agentA.raw_text}`)
    lines.push('')
    lines.push(`**B 的观点：** ${round.agentB.raw_text}`)
    lines.push('')

    if (s.consensus_points.length > 0) {
      lines.push('**共识点：**')
      for (const p of s.consensus_points) {
        lines.push(`- ${p.topic}`)
      }
      lines.push('')
    }

    if (s.divergence_points.length > 0) {
      lines.push('**分歧点：**')
      for (const p of s.divergence_points) {
        lines.push(`- **${p.topic}**：A 认为「${p.a_position}」，B 认为「${p.b_position}」`)
      }
      lines.push('')
    }

    if (s.next_round_focus) {
      lines.push(`**下轮焦点：** ${s.next_round_focus}`)
      lines.push('')
    }
  }

  // Final conclusion
  if (result.finalSummary) {
    const fs = result.finalSummary
    lines.push('---')
    lines.push('')

    if (fs.conclusion_level === 'L1') {
      lines.push('## ✅ 最终结论（双方达成共识）')
      lines.push('')
      lines.push(fs.conclusion || '')
    } else {
      lines.push('## ⚡ 最终结论（存在分歧）')
      lines.push('')
      if (fs.conclusion) {
        lines.push(fs.conclusion)
        lines.push('')
      }
      if (fs.divergence_points.length > 0) {
        lines.push('**核心分歧：**')
        for (const p of fs.divergence_points) {
          lines.push(`- **${p.topic}**：A「${p.a_position}」vs B「${p.b_position}」`)
        }
      }
    }
  }

  return lines.join('\n')
}

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('Server error:', err)
  process.exit(1)
})
