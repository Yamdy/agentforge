import { describe, it, expect } from "vitest";

import {
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createGlobTool,
	type EditToolInput,
	type EditToolDetails,
	type WriteToolInput,
	type WriteToolDetails,
	type GrepToolInput,
	type GrepToolDetails,
} from "./index.js";

describe("cli tools/index — exports (T8)", () => {
	it("exports createEditTool + EditToolInput/EditToolDetails types", () => {
		const tool = createEditTool();
		expect(tool.name).toBe("edit");
		// type compile-time presence (runtime no-op)
		const _input: EditToolInput = {
			path: "x",
			old_string: "a",
			new_string: "b",
		};
		const _details: EditToolDetails = { path: "x", replacements: 1 };
		void _input;
		void _details;
	});

	it("exports createWriteTool + WriteToolInput/WriteToolDetails types", () => {
		const tool = createWriteTool();
		expect(tool.name).toBe("write");
		const _input: WriteToolInput = { path: "x", content: "c" };
		const _details: WriteToolDetails = {
			path: "x",
			bytes: 1,
			created: true,
		};
		void _input;
		void _details;
	});

	it("exports createGrepTool + GrepToolInput/GrepToolDetails types", () => {
		const tool = createGrepTool();
		expect(tool.name).toBe("grep");
		const _input: GrepToolInput = { pattern: "x" };
		const _details: GrepToolDetails = { exitCode: 0 };
		void _input;
		void _details;
	});

	it("exports createGlobTool (already present pre-T8)", () => {
		const tool = createGlobTool();
		expect(tool.name).toBe("glob");
	});

	it("read + bash still exported (regression)", () => {
		expect(createReadTool().name).toBe("read");
		expect(createBashTool().name).toBe("bash");
	});
});
