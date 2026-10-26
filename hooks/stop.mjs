/**
 * Stop hook: Claude has finished replying. The time it spent working does not
 * count as silence, so the quiet clock restarts from here.
 */
import { readJson, failOpen } from '../lib/hook-io.mjs';
import { loadState, saveState } from '../lib/state.mjs';

await failOpen(async () => {
	const input = await readJson();
	const now = Date.now();
	const state = loadState(input.session_id, now);
	state.lastStopAt = now;
	state.working = false;
	saveState(input.session_id, state);
	return null;
});
