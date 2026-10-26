/**
 * UserPromptSubmit hook: the nudger, sitting between you and Claude.
 *
 * It runs each time you submit a prompt, before Claude sees it.
 *
 *  1. The prompt is scored from 0 (passive) to 3 (interactive).
 *  2. If it is passive while your average so far is below 1.5, it is held
 *     back with a warning. Submit the SAME text again to send it as it is,
 *     or change it and submit. This stands in for the "Edit / Send anyway"
 *     dialog, which a hook cannot show.
 *  3. Otherwise it goes through. If your last two prompts average below 1.5
 *     you also see a nudge, which only you see.
 *
 * Scoring never blocks you: with no key, no network, a slow reply or any
 * error, the prompt goes through unscored.
 */
import { readJson, failOpen } from '../lib/hook-io.mjs';
import { loadDotEnv } from '../lib/env.mjs';
import { loadState, saveState, logEvent, means } from '../lib/state.mjs';
import { lastAgentReply } from '../lib/transcript.mjs';
import { scorePrompt } from '../lib/score.mjs';
import {
	echoesReply,
	globalAverage,
	recentAverage,
	shouldNudgeForRecent,
	shouldWarnBeforeSend
} from '../lib/engagement.mjs';

await failOpen(async () => {
	loadDotEnv();
	const input = await readJson();

	// Only prompts you typed: not `claude -p`, scheduled runs or injected turns.
	// (NUDGE_INCLUDE_NON_USER lets tests drive this through `claude -p`.)
	if (input.source && input.source !== 'user' && !process.env.NUDGE_INCLUDE_NON_USER) return null;
	const prompt = String(input.prompt ?? '').trim();
	if (!prompt || prompt.startsWith('/')) return null;

	const sessionId = input.session_id;
	const now = Date.now();
	const state = loadState(sessionId, now);

	const reply = lastAgentReply(input.transcript_path);
	const echo = echoesReply(prompt, reply);
	const scored = await scorePrompt({ prompt, reply, pasted: echo });

	// You are active either way, so the silence clock restarts.
	state.lastPromptAt = now;
	state.working = true;
	state.workingSince = now;

	if (!scored) {
		saveState(sessionId, state);
		return null;
	}

	const sentAfterWarning = state.warnedText === prompt;

	// A passive prompt on a low average is held back once.
	if (!sentAfterWarning && shouldWarnBeforeSend(state.scores, scored.score)) {
		state.warnedText = prompt;
		state.working = false;
		saveState(sessionId, state);
		logEvent(sessionId, {
			kind: 'warning',
			action: 'shown',
			text: prompt,
			score: scored.score,
			rationale: scored.rationale,
			model: scored.model,
			echo,
			...means(state.scores)
		});
		const overall = (globalAverage(state.scores) ?? 0).toFixed(1);
		return {
			decision: 'block',
			reason:
				`This message looks like a simple acceptance, and your messages so far average ${overall} out of 3 for engagement. ` +
				'Adding what you expect, or what you would change, keeps you involved in the work.\n\n' +
				'To send it as it is, submit the same message again. Or edit it first.'
		};
	}

	state.warnedText = null;
	state.scores.push(scored.score);
	logEvent(sessionId, {
		kind: 'prompt',
		action: sentAfterWarning ? 'sent_after_warning' : 'sent',
		text: prompt,
		score: scored.score,
		rationale: scored.rationale,
		model: scored.model,
		echo,
		...means(state.scores)
	});

	let output = null;
	if (shouldNudgeForRecent(state.scores)) {
		const recent = (recentAverage(state.scores) ?? 0).toFixed(1);
		state.nudges += 1;
		logEvent(sessionId, {
			kind: 'nudge',
			action: 'low_recent_average',
			text: 'Take a more active part',
			...means(state.scores)
		});
		output = {
			systemMessage:
				`Take a more active part: your last two messages average ${recent} out of 3. ` +
				"Try adding your own idea, a reason for a choice, or something you disagree with in Claude's last answer."
		};
	}
	saveState(sessionId, state);
	return output;
});
