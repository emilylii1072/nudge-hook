/**
 * The hooks run as Claude Code runs them: a process that gets JSON on stdin
 * and answers on stdout. The scorer is faked, so no model is called.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let data;

before(() => {
	data = mkdtempSync(join(tmpdir(), 'nudge-data-'));
});
after(() => rmSync(data, { recursive: true, force: true }));

function run(hook, input, env = {}) {
	const result = spawnSync(process.execPath, [join(root, 'hooks', hook)], {
		input: JSON.stringify(input),
		encoding: 'utf-8',
		env: { ...process.env, NUDGE_DATA_DIR: data, CLAUDE_PROJECT_DIR: root, ...env }
	});
	return { code: result.status, out: result.stdout.trim(), err: result.stderr };
}

const submit = (session, prompt, score, extra = {}) =>
	run('user-prompt-submit.mjs', { session_id: session, prompt, source: 'user', ...extra }, { NUDGE_FAKE_SCORE: String(score) });

const events = () =>
	readFileSync(join(data, 'events.jsonl'), 'utf-8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l));

describe('UserPromptSubmit', () => {
	it('lets a first prompt through, even a passive one, since there is no average yet', () => {
		const r = submit('s1', 'ok', 0);
		assert.equal(r.code, 0);
		assert.equal(r.out, '');
	});

	it('holds back a passive prompt on a low average, once', () => {
		const held = JSON.parse(submit('s1', 'yes', 0).out);
		assert.equal(held.decision, 'block');
		assert.match(held.reason, /submit the same message again/i);

		// The same text again goes through, and the low recent average earns a nudge.
		const again = JSON.parse(submit('s1', 'yes', 0).out);
		assert.equal(again.decision, undefined);
		assert.match(again.systemMessage, /Take a more active part/);
	});

	it('scores a changed message fresh', () => {
		assert.equal(JSON.parse(submit('s1', 'sure', 0).out).decision, 'block');
		const edited = submit('s1', 'sure, but split 70:30 because the data is small', 2);
		// Recent average is (0 + 2) / 2 = 1.0, still low, so a nudge but no block.
		assert.equal(JSON.parse(edited.out).decision, undefined);
	});

	it('does not nudge when the recent average is healthy', () => {
		assert.equal(submit('s2', 'use a random forest because the classes are imbalanced', 2).out, '');
		assert.equal(submit('s2', 'I expect overtime to be the top feature, test that', 3).out, '');
	});

	it('ignores slash commands, empty prompts and prompts that were not typed by you', () => {
		assert.equal(submit('s3', '/clear', 0).out, '');
		assert.equal(submit('s3', '   ', 0).out, '');
		const r = run('user-prompt-submit.mjs', { session_id: 's3', prompt: 'ok', source: 'sdk' }, { NUDGE_FAKE_SCORE: '0' });
		assert.equal(r.out, '');
		assert.ok(!events().some((e) => e.session === 's3'));
	});

	it('lets everything through when scoring is unavailable', () => {
		const r = run('user-prompt-submit.mjs', { session_id: 's4', prompt: 'ok', source: 'user' }, { ANTHROPIC_API_KEY: '', NUDGE_FAKE_SCORE: undefined });
		assert.equal(r.code, 0);
		assert.equal(r.out, '');
	});

	it('survives garbage input', () => {
		const r = spawnSync(process.execPath, [join(root, 'hooks', 'user-prompt-submit.mjs')], {
			input: 'this is not json',
			encoding: 'utf-8',
			env: { ...process.env, NUDGE_DATA_DIR: data }
		});
		assert.equal(r.status, 0);
		assert.equal(r.stdout.trim(), '');
	});

	it('logs prompts, warnings and nudges with the means', () => {
		const rows = events().filter((e) => e.session === 's1');
		assert.deepEqual(
			rows.map((e) => `${e.kind}:${e.action}`),
			[
				'prompt:sent',
				'warning:shown',
				'prompt:sent_after_warning',
				'nudge:low_recent_average',
				'warning:shown',
				'prompt:sent',
				'nudge:low_recent_average'
			]
		);
		assert.equal(rows[0].score, 0);
		assert.equal(rows[2].mean_all, 0);
	});

	it('flags a prompt that repeats the previous reply', () => {
		const transcript = join(data, 't.jsonl');
		const reply = 'The model reaches 0.82 AUC on the held-out set and the top feature is overtime.';
		writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } }) + '\n');
		submit('s5', reply, 0, { transcript_path: transcript });
		assert.equal(events().filter((e) => e.session === 's5').at(-1).echo, true);
	});
});

describe('Stop and the status line', () => {
	it('says no scores yet at the start', () => {
		const r = run('statusline.mjs', { session_id: 'fresh' });
		assert.match(r.out, /no messages scored yet/);
	});

	it('shows the average', () => {
		const r = run('statusline.mjs', { session_id: 's2' });
		assert.match(r.out, /engagement 2\.5 \/ 3 over 2 messages/);
	});

	function backdate(session, minutesAgo, extra = {}) {
		const file = join(data, 'sessions', `${session}.json`);
		const state = JSON.parse(readFileSync(file, 'utf-8'));
		const then = Date.now() - minutesAgo * 60_000;
		Object.assign(state, { startedAt: then, lastPromptAt: then, lastStopAt: null, working: false, ...extra });
		writeFileSync(file, JSON.stringify(state));
	}

	it('shows the nudge after five quiet minutes, and logs it once', () => {
		backdate('s2', 6);
		assert.match(run('statusline.mjs', { session_id: 's2' }).out, /No message in 5 minutes/);
		run('statusline.mjs', { session_id: 's2' });
		const logged = events().filter((e) => e.session === 's2' && e.action === 'no_prompt_5_minutes');
		assert.equal(logged.length, 1);
	});

	it('does not count the time Claude is working', () => {
		backdate('s2', 6, { working: true, workingSince: Date.now() - 6 * 60_000 });
		assert.doesNotMatch(run('statusline.mjs', { session_id: 's2' }).out, /No message in 5 minutes/);
	});

	it('restarts the clock when Claude finishes', () => {
		backdate('s2', 6, { working: true, workingSince: Date.now() - 6 * 60_000 });
		run('stop.mjs', { session_id: 's2' });
		const out = run('statusline.mjs', { session_id: 's2' }).out;
		assert.doesNotMatch(out, /No message in 5 minutes/);
		assert.match(out, /engagement/);
	});

	it('exports the log as CSV', () => {
		const r = spawnSync(process.execPath, [join(root, 'tools', 'export-csv.mjs')], {
			encoding: 'utf-8',
			env: { ...process.env, NUDGE_DATA_DIR: data }
		});
		const lines = r.stdout.trim().split('\n');
		assert.match(lines[0], /^created,session,kind,action,text,score/);
		assert.ok(lines.length > 5);
		assert.ok(existsSync(join(data, 'events.jsonl')));
	});
});
