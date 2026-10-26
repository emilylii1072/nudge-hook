/**
 * What the nudger remembers about a session, and the log it keeps.
 *
 * Everything lives in `.nudge/` inside this folder. Each session has its own
 * state file, so a new session starts with a fresh average. The log is shared
 * and append-only, one JSON object per line.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { average, recentAverage } from './engagement.mjs';

/** This folder, whatever directory Claude was started from. */
export const ROOT = process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..');

export const dataDir = () => {
	const dir = join(process.env.NUDGE_DATA_DIR || join(ROOT, '.nudge'));
	mkdirSync(join(dir, 'sessions'), { recursive: true });
	return dir;
};

/** A session id becomes a file name, so keep it to safe characters. */
const safeId = (id) => String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');

const stateFile = (sessionId) => join(dataDir(), 'sessions', `${safeId(sessionId)}.json`);

export function loadState(sessionId, now = Date.now()) {
	try {
		const state = JSON.parse(readFileSync(stateFile(sessionId), 'utf-8'));
		return { ...freshState(now), ...state };
	} catch {
		return freshState(now);
	}
}

function freshState(now) {
	return {
		startedAt: now,
		scores: [],
		lastPromptAt: null,
		lastStopAt: null,
		/** True from when you send a prompt until Claude finishes replying. */
		working: false,
		workingSince: null,
		/** The text of the last prompt that was held back with a warning. */
		warnedText: null,
		nudges: 0
	};
}

export function saveState(sessionId, state) {
	const file = stateFile(sessionId);
	const temp = `${file}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify(state), 'utf-8');
	renameSync(temp, file);
}

/** The means as of now, for the log. */
export function means(scores) {
	return { mean_all: average(scores), mean_recent: recentAverage(scores) };
}

const logFile = () => join(dataDir(), 'events.jsonl');

/** Append one event to the log. A logging failure never stops a prompt. */
export function logEvent(sessionId, event) {
	try {
		const row = {
			created: new Date().toISOString(),
			session: sessionId ?? '',
			kind: event.kind,
			action: event.action ?? '',
			text: event.text ?? '',
			score: event.score ?? null,
			rationale: event.rationale ?? '',
			model: event.model ?? '',
			echo: event.echo === true,
			mean_all: event.mean_all ?? null,
			mean_recent: event.mean_recent ?? null
		};
		appendFileSync(logFile(), JSON.stringify(row) + '\n', 'utf-8');
	} catch {
		// logging must never get in the way
	}
}

const CSV_COLUMNS = ['created', 'session', 'kind', 'action', 'text', 'score', 'rationale', 'model', 'echo', 'mean_all', 'mean_recent'];

function csvCell(value) {
	if (value === null || value === undefined) return '';
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole log as CSV text. */
export function logToCsv() {
	const rows = existsSync(logFile())
		? readFileSync(logFile(), 'utf-8')
			.split('\n')
			.filter(Boolean)
			.map((line) => JSON.parse(line))
		: [];
	const lines = [CSV_COLUMNS.join(',')];
	for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
	return lines.join('\n') + '\n';
}
