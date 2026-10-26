import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastAgentReply } from '../lib/transcript.mjs';

const dir = mkdtempSync(join(tmpdir(), 'nudge-transcript-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const user = (content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const assistant = (blocks, extra = {}) => ({ type: 'assistant', message: { role: 'assistant', content: blocks }, ...extra });
const text = (t) => ({ type: 'text', text: t });

function write(name, rows) {
	const path = join(dir, name);
	writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
	return path;
}

describe('lastAgentReply', () => {
	it("returns Claude's words since the last real prompt", () => {
		const path = write('a.jsonl', [
			user('first question'),
			assistant([text('old answer')]),
			user('second question'),
			assistant([{ type: 'thinking', thinking: 'hmm' }]),
			assistant([text('Let me look.'), { type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
			user([{ type: 'tool_result', tool_use_id: 't1', content: 'file text' }]),
			assistant([text('Here is the answer.')])
		]);
		assert.equal(lastAgentReply(path), 'Let me look.\n\nHere is the answer.');
	});

	it('treats a prompt given as a list of text blocks as a real prompt', () => {
		const path = write('b.jsonl', [assistant([text('older')]), user([text('hi')]), assistant([text('newer')])]);
		assert.equal(lastAgentReply(path), 'newer');
	});

	it('ignores subagent (sidechain) messages', () => {
		const path = write('c.jsonl', [
			user('go'),
			assistant([text('from a subagent')], { isSidechain: true }),
			assistant([text('main reply')])
		]);
		assert.equal(lastAgentReply(path), 'main reply');
	});

	it('returns an empty string for no reply, odd lines, or a missing file', () => {
		assert.equal(lastAgentReply(write('d.jsonl', [user('only a prompt')])), '');
		assert.equal(lastAgentReply(join(dir, 'missing.jsonl')), '');
		const path = join(dir, 'e.jsonl');
		writeFileSync(path, 'not json\n' + JSON.stringify(assistant([text('ok then')])) + '\n');
		assert.equal(lastAgentReply(path), 'ok then');
	});
});
