export type ConclusionLevel = 'L1' | 'L3'
export type DivergenceType = 'fact' | 'judgment'
export type Confidence = 'high' | 'medium' | 'low'

export interface ConsensusPoint {
  topic: string
  confidence: Confidence
  agreed_by: ('A' | 'B')[]
}

export interface DivergencePoint {
  topic: string
  a_position: string
  b_position: string
  divergence_type: DivergenceType
  reason?: string
}

export interface JudgeSummary {
  round: number
  conclusion_level: ConclusionLevel
  status_description?: string
  consensus_points: ConsensusPoint[]
  divergence_points: DivergencePoint[]
  next_round_focus: string | null
  conclusion: string | null
}

export interface AgentPoint {
  content: string
  confidence: Confidence
}

export interface PeerReviewItem {
  point: string
  agree: 'agree' | 'partially_agree' | 'disagree'
  boundary_test?: string
  reason?: string
}

export interface AgentResponse {
  agent: 'A' | 'B'
  points: AgentPoint[]
  peer_review?: PeerReviewItem[]
  raw_text: string
}

export interface DiscussionRound {
  round: number
  agentA: AgentResponse
  agentB: AgentResponse
  judgeSummary: JudgeSummary
}

export interface DiscussionResult {
  status: 'concluded'
  question: string
  rounds: DiscussionRound[]
  finalSummary: JudgeSummary | null
}
