import { defineConfig } from "vitest/config";

// vitest 默认 testTimeout 5000ms；Windows 慢环境下 repl/print-mode 调
// harness.prompt 的测试触发 timeout 误报。放宽到 15000ms 吸收 flaky。
export default defineConfig({
  test: {
    testTimeout: 15000,
  },
});
