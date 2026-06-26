/**
 * 示例 task 汇出(spec §4.4 / plan Task 6)。
 *
 * 三个示例 task 验 eval 框架(非生产 suite,red-team 🟡 4 defer 生产 suite):
 * - readFileTask:file-contains
 * - editAddCommentTask:file-contains
 * - runTestTask:exit-zero
 */
export { readFileTask } from "./read-file-name.js";
export { editAddCommentTask } from "./edit-add-comment.js";
export { runTestTask } from "./run-test.js";

/** 全部示例 task(供 runner/CLI 按 suite 加载)。 */
import { readFileTask } from "./read-file-name.js";
import { editAddCommentTask } from "./edit-add-comment.js";
import { runTestTask } from "./run-test.js";
import type { Task } from "../types.js";

export const sampleTasks: Task[] = [readFileTask, editAddCommentTask, runTestTask];
