import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// 单 project：root = agentforge，include 通配所有包测试。
//
// workspace 包名（@agentforge/*）解析到源码靠 packages 下各 package.json exports
// 的 "development" condition（vite serve 默认用 development condition → 读 src），
// 见 packages/cli/src/resolve.test.ts 防回归测试。
//
// 注意：vitest 4 workspace 数组形式的 resolve.alias / test.alias 实测不生效
// （vite 仍走 node resolution 到 node_modules 的 pnpm symlink → dist），
// server.deps.inline 也未能纠正。故不在此配 alias，统一靠 development condition。
export default [
  {
    root,
    test: {
      name: "agentforge",
      include: ["packages/*/src/**/*.test.ts"],
    },
  },
];
