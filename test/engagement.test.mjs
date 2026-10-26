import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	SILENCE_MS,
	average,
	echoesReply,
	parseScoreReply,
	recentAverage,
	shouldNudgeForRecent,
	shouldNudgeForSilence,
	shouldWarnBeforeSend
} from '../lib/engagement.mjs';

describe('averages', () => {
	it('averages all scores, and returns null for none', () => {
		assert.equal(average([]), null);
		assert.equal(average([0, 3]), 1.5);
	});

	it('averages the latest two, and needs two', () => {
		assert.equal(recentAverage([3]), null);
		assert.equal(recentAverage([3, 0, 1]), 0.5);
	});
});

describe('shouldNudgeForRecent', () => {
	it('nudges when the last two average below 1.5', () => {
		assert.equal(shouldNudgeForRecent([0, 1]), true);
		assert.equal(shouldNudgeForRecent([3, 0, 1]), true);
	});
	it('does not nudge at 1.5 or above, or with too few', () => {
		assert.equal(shouldNudgeForRecent([1, 2]), false);
		assert.equal(shouldNudgeForRecent([0]), false);
		assert.equal(shouldNudgeForRecent([]), false);
	});
});

describe('shouldWarnBeforeSend', () => {
	it('warns for a passive draft when the average is low', () => {
		assert.equal(shouldWarnBeforeSend([0, 1], 0), true);
	});
	it('does not warn for a non-passive draft', () => {
		assert.equal(shouldWarnBeforeSend([0, 1], 1), false);
	});
	it('does not warn when the average is healthy or absent', () => {
		assert.equal(shouldWarnBeforeSend([3, 2], 0), false);
		assert.equal(shouldWarnBeforeSend([], 0), false);
	});
});

describe('shouldNudgeForSilence', () => {
	it('nudges after five minutes of quiet', () => {
		assert.equal(shouldNudgeForSilence(SILENCE_MS - 1, 0), false);
		assert.equal(shouldNudgeForSilence(SILENCE_MS, 0), true);
	});
});

describe('parseScoreReply', () => {
	it('reads a plain reply', () => {
		assert.deepEqual(parseScoreReply('{"score": 2, "rationale": "own idea"}'), { score: 2, rationale: 'own idea' });
	});
	it('reads a reply wrapped in text', () => {
		assert.equal(parseScoreReply('Here: {"score": 3, "rationale": "x"} done').score, 3);
	});
	it('reads the score from a reply that was cut off before it finished', () => {
		const cut = '{"score": 2, "label": "constructive", "rationale": "The participant raises their own concern by asking to check whe';
		assert.deepEqual(parseScoreReply(cut), { score: 2, rationale: '' });
		assert.equal(parseScoreReply('{"score": 0, "label": "passive", "rat').score, 0);
	});
	it('rejects bad scores and non-JSON', () => {
		assert.equal(parseScoreReply('{"score": 4}'), null);
		assert.equal(parseScoreReply('{"score": 1.5}'), null);
		assert.equal(parseScoreReply('no json here'), null);
	});
});

describe('echoesReply', () => {
	const reply = 'The model reaches 0.82 AUC on the held-out set.\nThe top feature is overtime, followed by tenure and age.';

	it('is true when the prompt is the reply pasted back', () => {
		assert.equal(echoesReply(reply, reply), true);
		assert.equal(echoesReply(`ok, ${reply}`, reply), true);
	});
	it('is true for most lines of the reply', () => {
		assert.equal(echoesReply('The top feature is overtime, followed by tenure and age.', reply), true);
	});
	it('is false for your own words', () => {
		assert.equal(echoesReply('I think tenure matters more than overtime, please check that with a permutation test.', reply), false);
	});
	it('is false for short prompts and when there is no reply', () => {
		assert.equal(echoesReply('ok', reply), false);
		assert.equal(echoesReply(reply, ''), false);
	});
});
