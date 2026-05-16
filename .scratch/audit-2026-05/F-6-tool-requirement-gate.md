# F-6 [MEDIUM] Tool Requirements Only in Prompt Text

## Status: open

## Summary

无代码层面的 "必须调用工具 X" 强制执行。prompt 说必须用但模型可跳过。

## Evidence

- 全代码库无 tool requirement gate

## Acceptance Criteria

- [ ] AgentConfig 支持 `requiredTools?: string[]`
- [ ] evaluateIteration 检查 requiredTools 是否在当前 iteration 的 tool calls 中
- [ ] 缺失时 emit warning 或阻止 stop

## Priority

P-2 — 工具纪律
