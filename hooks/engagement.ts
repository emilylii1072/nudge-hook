/**
 * Rules for when to warn or nudge. Every prompt gets an ICAP score from 0 to 3
 * (see rubric.ts). These functions only decide what to do with the scores, so
 * they can be tested without a model call.
 */

/** An average below this counts as low engagement. */
export const ENGAGEMENT_THRESHOLD = 1.5

/** How many of the latest prompts the recent average covers. */
export const RECENT_COUNT = 2

export function average(scores: readonly number[]): number | null {
  if (scores.length === 0) return null
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

export function recentAverage(scores: readonly number[]): number | null {
  if (scores.length < RECENT_COUNT) return null
  return average(scores.slice(-RECENT_COUNT))
}

export function shouldNudgeForRecent(scores: readonly number[]): boolean {
  const recent = recentAverage(scores)
  return recent !== null && recent < ENGAGEMENT_THRESHOLD
}

/** A passive draft (score 0) while the average of earlier prompts is low. */
export function shouldWarnBeforeSend(scores: readonly number[], draftScore: number): boolean {
  const overall = average(scores)
  return overall !== null && overall < ENGAGEMENT_THRESHOLD && draftScore === 0
}

export function shouldNudgeForSilence(now: number, quietSince: number, silenceMs: number): boolean {
  return now - quietSince >= silenceMs
}

export type Scored = { score: number; rationale: string }

/** Read the model's reply into { score, rationale }, or null if it cannot be read. */
export function parseScoreReply(reply: string): Scored | null {
  const match = reply.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      const score = parsed.score
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 3) return null
      return { score, rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '' }
    } catch {
      // fall through to the partial reading below
    }
  }
  // A long rationale can run past the token limit and cut the JSON off. The
  // score is written first, so it can still be read from what arrived.
  const partial = reply.match(/"score"\s*:\s*([0-3])\s*[,}]/)
  return partial ? { score: Number(partial[1]), rationale: '' } : null
}

function fiveWordRuns(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const runs: string[] = []
  for (let i = 0; i + 5 <= words.length; i++) runs.push(words.slice(i, i + 5).join(' '))
  return runs
}

/** True when most of the prompt is text Claude just said (a pasted-back answer). */
export function echoesReply(prompt: string, reply: string): boolean {
  const promptRuns = fiveWordRuns(prompt)
  if (promptRuns.length < 4 || reply.trim() === '') return false
  const replyRuns = new Set(fiveWordRuns(reply))
  const found = promptRuns.filter(run => replyRuns.has(run)).length
  return found / promptRuns.length >= 0.8
}
