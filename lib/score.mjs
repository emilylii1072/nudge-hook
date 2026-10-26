/**
 * Score one prompt on the ICAP scale with Claude.
 *
 * The rubric the model reads is `rubric.md` in this folder. The reply is read
 * by `parseScoreReply`. Any failure (no key, no network, a slow reply, an
 * unreadable answer) returns null, and the caller lets your prompt through.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScoreReply } from './engagement.mjs';

export const SCORER_MODEL = () => process.env.NUDGE_SCORER_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = () => Number(process.env.NUDGE_SCORE_TIMEOUT_MS) || 12_000;
const MAX_REPLY_CHARS = 4000;

const rubric = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rubric.md'), 'utf-8');

/** @returns {Promise<{score: number, rationale: string, model: string} | null>} */
export async function scorePrompt({ prompt, reply = '', pasted = false }) {
	// Tests set this so no model is called.
	if (process.env.NUDGE_FAKE_SCORE !== undefined) {
		const score = Number(process.env.NUDGE_FAKE_SCORE);
		return Number.isInteger(score) ? { score, rationale: 'fake score for testing', model: 'fake' } : null;
	}

	const key = process.env.ANTHROPIC_API_KEY;
	if (!key) return null;

	try {
		const res = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			signal: AbortSignal.timeout(TIMEOUT_MS()),
			headers: {
				'content-type': 'application/json',
				'x-api-key': key,
				'anthropic-version': '2023-06-01'
			},
			body: JSON.stringify({
				model: SCORER_MODEL(),
				max_tokens: 800,
				system: rubric(),
				messages: [
					{
						role: 'user',
						content: JSON.stringify({
							previous_agent_reply: reply.slice(-MAX_REPLY_CHARS),
							prompt,
							pasted: pasted === true
						})
					}
				]
			})
		});
		if (!res.ok) return null;
		const data = await res.json();
		const text = (data.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('');
		const scored = parseScoreReply(text);
		return scored ? { ...scored, model: SCORER_MODEL() } : null;
	} catch {
		return null;
	}
}
