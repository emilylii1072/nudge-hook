/**
 * Write the engagement log as CSV.
 *
 *   node tools/export-csv.mjs > prompt_events.csv
 */
import { logToCsv } from '../lib/state.mjs';

process.stdout.write(logToCsv());
