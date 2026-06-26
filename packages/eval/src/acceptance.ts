/**
 * Slice 7 eval 包 acceptance check 实现(spec §4.2 / plan Task 2)。
 *
 * runAcceptance(checks, sandbox, reply):声明式 check 在 sandbox 内跑。
 * - file-exists:path(相对 sandbox)存在
 * - file-contains:文件内容含 contains 子串
 * - exit-zero:在 sandbox cwd 跑 command,退出码 0
 *
 * 全过 → true;任一不过 → false(遇异常也 false,不抛)。
 *
 * 安全:声明式 check(red-team ⚪ 7:避免任意函数);path 限定 sandbox 内(防逃逸)。
 * reply 参数留作未来 reply-contains check 扩展;当前 check kind 不消费它。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { AcceptanceCheck } from "./types.js";

export function runAcceptance(
	checks: AcceptanceCheck[],
	sandbox: string,
	reply: string,
): boolean {
	for (const check of checks) {
		if (!runOne(check, sandbox, reply)) {
			return false;
		}
	}
	return true;
}

function runOne(
	check: AcceptanceCheck,
	sandbox: string,
	_reply: string,
): boolean {
	try {
		switch (check.kind) {
			case "file-exists":
				return runFileExists(check, sandbox);
			case "file-contains":
				return runFileContains(check, sandbox);
			case "exit-zero":
				return runExitZero(check, sandbox);
			default:
				return false;
		}
	} catch {
		// 声明式 check:异常(文件不存在/命令失败)统一判 false,不抛给 runner。
		return false;
	}
}

function runFileExists(check: AcceptanceCheck, sandbox: string): boolean {
	if (!check.path) return false;
	const full = path.resolve(sandbox, check.path);
	if (!isInside(full, sandbox)) return false; // 防路径逃逸
	return fs.existsSync(full);
}

function runFileContains(check: AcceptanceCheck, sandbox: string): boolean {
	if (!check.path || check.contains === undefined) return false;
	const full = path.resolve(sandbox, check.path);
	if (!isInside(full, sandbox)) return false;
	if (!fs.existsSync(full)) return false;
	const content = fs.readFileSync(full, "utf-8");
	return content.includes(check.contains);
}

function runExitZero(check: AcceptanceCheck, sandbox: string): boolean {
	if (!check.command) return false;
	// stdio pipe 抑制输出;异常(非 0 退出)抛 → 上层 catch 转 false。
	execSync(check.command, { cwd: sandbox, stdio: "ignore" });
	return true;
}

/** 校验 full 仍在 sandbox 内(防 ../ 逃逸)。 */
function isInside(full: string, sandbox: string): boolean {
	const rel = path.relative(sandbox, full);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
