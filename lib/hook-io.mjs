/** Reading a hook's input and running it so that no failure can block you. */

export async function readJson() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString('utf-8').trim();
	return text ? JSON.parse(text) : {};
}

/**
 * Run a hook body. Whatever it throws, the hook exits quietly with success,
 * which for Claude Code means "go ahead". A nudger that could break your
 * typing would be worse than none.
 */
export async function failOpen(body) {
	try {
		const output = await body();
		if (output) process.stdout.write(JSON.stringify(output));
	} catch {
		// say nothing, block nothing
	}
	process.exit(0);
}
