/**
 * 内置工具集合（见 ARCHITECTURE.md §5）。Slice 0：read + bash。
 * Task 7 接通 cli 时从此处 import。
 */
export { createReadTool, type ReadToolInput, type ReadToolDetails } from "./read.js";
export { createBashTool, type BashToolInput, type BashToolDetails } from "./bash.js";
