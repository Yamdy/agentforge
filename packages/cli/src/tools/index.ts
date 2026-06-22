/**
 * 内置工具集合（见 ARCHITECTURE.md §5）。
 * Slice 0：read + bash + glob。Slice 2 T8：接 edit + write + grep。
 * cli（repl/print-mode）从此处 import 全部工具并挂到 harness。
 */
export { createReadTool, type ReadToolInput, type ReadToolDetails } from "./read.js";
export { createBashTool, type BashToolInput, type BashToolDetails } from "./bash.js";
export { createGlobTool, type GlobToolInput, type GlobToolDetails, globToRegExp } from "./glob.js";
export { createEditTool, type EditToolInput, type EditToolDetails } from "./edit.js";
export { createWriteTool, type WriteToolInput, type WriteToolDetails } from "./write.js";
export { createGrepTool, type GrepToolInput, type GrepToolDetails } from "./grep.js";
