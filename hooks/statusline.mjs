/**
 * Status line: shows your engagement, and after five quiet minutes it shows
 * the nudge to work with Claude. Hooks only run on events, so a status line
 * that Claude Code refreshes every half minute is what can notice the clock.
 *
 * Time while Claude is working does not count: the quiet clock runs from the
 * latest of your last prompt, the end of Claude's last reply and the start
 * of the session.
 */
import { readJson } from '../lib/hook-io.mjs';
import { loadState, saveState, logEvent, means } from '../lib/state.mjs';
import { average, shouldNudgeForSilence } from '../lib/engagement.mjs';

/** A "working" flag older than this is a hook that never reported back. */
const STALE_WORKING_MS = 30 * 60 * 1000;

try {
	const input = await readJson();
	const now = Date.now();
	const state = loadState(input.session_id, now);

	const working = state.working && now - (state.workingSince ?? now) < STALE_WORKING_MS;
	const quietSince = Math.max(state.startedAt, state.lastPromptAt ?? 0, state.lastStopAt ?? 0);

	if (!working && shouldNudgeForSilence(now, quietSince)) {
		// Log the nudge once per quiet period.
		if (state.silenceShownFor !== quietSince) {
			state.silenceShownFor = quietSince;
			state.nudges += 1;
			logEvent(input.session_id, {
				kind: 'nudge',
				action: 'no_prompt_5_minutes',
				text: 'Keep working with the agent',
				...means(state.scores)
			});
		}
		saveState(input.session_id, state);
		process.stdout.write(
			"💬 No message in 5 minutes. Tell Claude what you think should happen next, or challenge something in its last answer."
		);
	} else {
		saveState(input.session_id, state);
		const avg = average(state.scores);
		process.stdout.write(
			avg === null ? 'Nudge: no messages scored yet' : `Nudge: engagement ${avg.toFixed(1)} / 3 over ${state.scores.length} messages`
		);
	}
} catch {
	// a status line that fails should just be empty
}
process.exit(0);
