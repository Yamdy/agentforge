import { test, expect } from "vitest";
import { __MODULE_URL__ } from "@agentforge/harness";

/**
 * 防回归：@agentforge/harness 解析到源码（src）而非 dist。
 *
 * 方案：packages 下各 package.json exports 加 "development": "./src/index.ts" condition。
 * vite serve（vitest）默认用 development condition → 读 src；build/typecheck 用
 * import/types → dist。此测试断言 __MODULE_URL__（模块实际加载 URL）含 "harness/src"，
 * 捕获 development condition 被删/失效导致回退 dist 的情况。
 */
test("@agentforge/harness 解析到 src（防 dist 回退回归）", () => {
	expect(__MODULE_URL__).toContain("harness/src");
});
