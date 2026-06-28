import { describe, it, expect } from "vitest";

import { makeReadlineAskHandler, formatAskArgs } from "./repl.js";

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
		expect(rl.written).toContain("Allow bash");
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

describe("formatAskArgs", () => {
	it("shows file path for write tool", () => {
		expect(formatAskArgs("write", { path: "/tmp/foo.ts" })).toBe("path: /tmp/foo.ts");
	});

	it("shows file path for edit tool", () => {
		expect(formatAskArgs("edit", { path: "/src/app.ts" })).toBe("path: /src/app.ts");
	});

	it("shows command for bash tool", () => {
		expect(formatAskArgs("bash", { command: "git push origin main" })).toBe("cmd: git push origin main");
	});

	it("shows path for read tool", () => {
		expect(formatAskArgs("read", { path: "/etc/hosts" })).toBe("path: /etc/hosts");
	});

	it("shows pattern for grep tool", () => {
		expect(formatAskArgs("grep", { pattern: "TODO", path: "/src" })).toBe('pattern: "TODO" in /src');
	});

	it("shows pattern for glob tool", () => {
		expect(formatAskArgs("glob", { pattern: "**/*.ts" })).toBe("pattern: **/*.ts");
	});

	it("truncates long args for unknown tools", () => {
		const long = "x".repeat(300);
		const result = formatAskArgs("custom", { data: long });
		expect(result.length).toBeLessThanOrEqual(201); // 200 + "…"
		expect(result).toContain("…");
	});

	it("returns empty string for null args", () => {
		expect(formatAskArgs("bash", null)).toBe("");
	});
});

describe("makeReadlineAskHandler — shows args in prompt", () => {
	it("bash prompt includes command", async () => {
		const rl = makeRl(["y"]) as any;
		const handler = makeReadlineAskHandler(rl);
		await handler({ toolName: "bash", args: { command: "git push" }, cwd: "/tmp" });
		expect(rl.written).toContain("git push");
	});

	it("write prompt includes file path", async () => {
		const rl = makeRl(["y"]) as any;
		const handler = makeReadlineAskHandler(rl);
		await handler({ toolName: "write", args: { path: "/tmp/secret.txt" }, cwd: "/tmp" });
		expect(rl.written).toContain("/tmp/secret.txt");
	});

	it("edit prompt includes file path", async () => {
		const rl = makeRl(["y"]) as any;
		const handler = makeReadlineAskHandler(rl);
		await handler({ toolName: "edit", args: { path: "/src/main.ts" }, cwd: "/tmp" });
		expect(rl.written).toContain("/src/main.ts");
	});
});
