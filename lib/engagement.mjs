/**
 * Rules for when to warn or nudge you about how engaged your prompts are.
 *
 * Every prompt gets an ICAP score from 0 to 3 (see `rubric.md`): 0 passive,
 * 1 active, 2 constructive, 3 interactive. These functions only decide what
 * to do with the scores, so they can be tested without a model call.
 */

/** An average below this counts as low engagement. */
export const ENGAGEMENT_THRESHOLD = 1.5;

/** Time without a new prompt before you are encouraged to collaborate. */
export const SILENCE_MS = 5 * 60 * 1000;

/** How many of your latest prompts the recent average covers. */
export const RECENT_COUNT = 2;

export function average(scores) {
	if (scores.length === 0) return null;
	return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/** The average of all your scored prompts, or null if there are none. */
export function globalAverage(scores) {
	return average(scores);
}

/** The average of your latest two scored prompts, or null if there are fewer than two. */
export function recentAverage(scores) {
	if (scores.length < RECENT_COUNT) return null;
	return average(scores.slice(-RECENT_COUNT));
}

/** True when the latest two prompts average below the threshold. */
export function shouldNudgeForRecent(scores) {
	const recent = recentAverage(scores);
	return recent !== null && recent < ENGAGEMENT_THRESHOLD;
}

/**
 * True when the prompt about to be sent is passive (score 0) while your
 * average over all earlier prompts is below the threshold. With no earlier
 * prompts there is no average, so nothing is warned about.
 */
export function shouldWarnBeforeSend(scores, draftScore) {
	const overall = globalAverage(scores);
	return overall !== null && overall < ENGAGEMENT_THRESHOLD && draftScore === 0;
}

/**
 * True when it is time to encourage you to collaborate because no prompt has
 * been sent for five minutes. `quietSince` is the latest of your last prompt,
 * the end of Claude's last reply, and the start of the session, so time spent
 * waiting for Claude does not count.
 */
export function shouldNudgeForSilence(now, quietSince) {
	return now - quietSince >= SILENCE_MS;
}

/** Read the model's reply into { score, rationale }, or null if it cannot be read. */
export function parseScoreReply(reply) {
	const match = reply.match(/\{[\s\S]*\}/);
	if (match) {
		try {
			const parsed = JSON.parse(match[0]);
			const score = parsed.score;
			if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 3) return null;
			return { score, rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '' };
		} catch {
			// fall through to the partial reading below
		}
	}
	// A long rationale can run past the token limit and cut the JSON off. The
	// score is written first, so it can still be read from what arrived.
	const partial = reply.match(/"score"\s*:\s*([0-3])\s*[,}]/);
	return partial ? { score: Number(partial[1]), rationale: '' } : null;
}

/** The runs of five words in a text, lower case and without punctuation. */
function fiveWordRuns(text) {
	const words = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
	const runs = [];
	for (let i = 0; i + 5 <= words.length; i++) runs.push(words.slice(i, i + 5).join(' '));
	return runs;
}

/**
 * True when most of the prompt is text Claude just said, which is what a
 * pasted-back answer looks like. A hook sees only text, so this stands in for
 * knowing whether you pasted it. It compares runs of five words, so a few
 * words of your own around the pasted text do not hide it.
 */
export function echoesReply(prompt, reply) {
	const promptRuns = fiveWordRuns(prompt);
	if (promptRuns.length < 4 || reply.trim() === '') return false;
	const replyRuns = new Set(fiveWordRuns(reply));
	const found = promptRuns.filter((run) => replyRuns.has(run)).length;
	return found / promptRuns.length >= 0.8;
}
