/**
 * Read the API key for scoring. It comes from the environment, or from a
 * `.env` file in this folder, so participants can put the key in one place.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './state.mjs';

export function loadDotEnv(file = join(ROOT, '.env')) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
		if (line.trim().startsWith('#')) continue;
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
		if (process.env[match[1]] === undefined && value !== '') process.env[match[1]] = value;
	}
}
