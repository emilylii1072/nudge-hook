/**
 * Reading Claude's last reply out of the session transcript.
 *
 * The transcript is a JSONL file with one entry per line. Entries of type
 * "user" and "assistant" carry `message.content`, which is a string or a
 * list of blocks. A tool result also arrives as a "user" entry, so a real
 * prompt is a user entry that is not only tool results.
 */
import { readFileSync } from 'node:fs';

const MAX_CHARS = 4000;

function blocksOf(content) {
	if (typeof content === 'string') return [{ type: 'text', text: content }];
	return Array.isArray(content) ? content : [];
}

function isRealPrompt(entry) {
	if (entry.type !== 'user' || entry.isSidechain) return false;
	const blocks = blocksOf(entry.message?.content);
	return blocks.some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '');
}

/**
 * Claude's words since your last prompt, which is what you are replying to.
 * Returns '' when there are none or the file cannot be read.
 */
export function lastAgentReply(transcriptPath) {
	let lines;
	try {
		lines = readFileSync(transcriptPath, 'utf-8').split('\n');
	} catch {
		return '';
	}

	const parts = [];
	for (let i = lines.length - 1; i >= 0; i--) {
		if (!lines[i].trim()) continue;
		let entry;
		try {
			entry = JSON.parse(lines[i]);
		} catch {
			continue;
		}
		if (isRealPrompt(entry)) break;
		if (entry.type !== 'assistant' || entry.isSidechain) continue;
		const text = blocksOf(entry.message?.content)
			.filter((b) => b.type === 'text' && typeof b.text === 'string')
			.map((b) => b.text.trim())
			.filter(Boolean)
			.join('\n\n');
		if (text) parts.unshift(text);
	}
	return parts.join('\n\n').slice(-MAX_CHARS);
}
