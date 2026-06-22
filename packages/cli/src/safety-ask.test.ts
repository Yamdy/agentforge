import { describe, it, expect } from "vitest";

import { makeReadlineAskHandler } from "./repl.js";

/** 最小 readline.Interface 兼容：question(q, cb) 立即用预置答案回调。 */
function makeRl(answers: string[]) {
	const queue = [...answers];
	let written = "";
	return {
		question: (q: string, cb: (answer: string) => void): void => {
			written += q;
			cb(queue.shift() ?? "n");
		},
		get written() {
			return written;
		},
	};
}

describe("cli safety-ask — makeReadlineAskHandler (T8)", () => {
	it("returns true when user answers 'y' (lowercase)", async () => {
		const rl = makeRl(["y"]) as any;
		const handler = makeReadlineAskHandler(rl);
		const ok = await handler({
			toolName: "bash",
			args: { command: "git push" },
			cwd: "/tmp",
		});
		expect(ok).toBe(true);
		// prompt format per spec: "Allow ${toolName}? (y/n) "
		expect(rl.written).toContain("Allow bash?");
		expect(rl.written).toContain("y/n");
	});

	it("returns false when user answers 'n'", async () => {
		const rl = makeRl(["n"]) as any;
		const handler = makeReadlineAskHandler(rl);
		const ok = await handler({
			toolName: "bash",
			args: { command: "git push" },
			cwd: "/tmp",
		});
		expect(ok).toBe(false);
	});

	it("trims and lowercases answer, accepts 'Y'", async () => {
		const rl = makeRl(["  Y  "]) as any;
		const handler = makeReadlineAskHandler(rl);
		const ok = await handler({
			toolName: "write",
			args: { path: "/tmp/x" },
			cwd: "/tmp",
		});
		expect(ok).toBe(true);
	});

	it("returns false for any non-'y' answer (e.g. 'no')", async () => {
		const rl = makeRl(["no"]) as any;
		const handler = makeReadlineAskHandler(rl);
		const ok = await handler({
			toolName: "bash",
			args: { command: "rm x" },
			cwd: "/tmp",
		});
		expect(ok).toBe(false);
	});
});
