# AgentForge Benchmark 框架

## 概述

本目录包含 AgentForge 的标准化性能基准测试框架，用于与其他 Agent 框架进行性能对比。

## 快速开始

```bash
# 运行所有基准测试
npx tsx benchmarks/run.ts

# 运行特定场景
npx tsx benchmarks/run.ts --scenario eventStreamCreation
```

## 测试场景

| 场景 | 描述 | 迭代次数 |
|------|------|---------|
| Event Stream Creation | Observable 事件流创建开销 | 1000 |
| Zod Schema Validation | Zod Schema 解析性能 | 10000 |
| Security Guard Check | 安全检查开销 | 10000 |
| Rate Limiter Check | 速率限制检查开销 | 100000 |
| Quota Controller Check | 配额控制开销 | 10000 |

## 性能指标

每个测试场景测量以下指标：

- **Avg Latency**: 平均延迟 (ms)
- **P50 Latency**: 50 分位延迟 (ms)
- **P95 Latency**: 95 分位延迟 (ms)
- **P99 Latency**: 99 分位延迟 (ms)
- **Throughput**: 吞吐量 (ops/sec)
- **Memory Usage**: 内存增量 (MB)

## 对比框架

| 框架 | 语言 | 测试方法 |
|------|------|---------|
| AgentForge | TypeScript | 本框架直接测试 |
| AgentScope | Python | 需要 Python 测试环境 |
| DeepAgents | Python | 需要 Python 测试环境 |
| Mastra | TypeScript | 需要 Node.js 22+ |

## 预期性能特征

基于 AgentForge 架构特点：

1. **事件流创建**: RxJS Observable 创建开销极低 (~0.1ms)
2. **Zod 验证**: 编译时类型安全 + 运行时验证 (~0.01ms/次)
3. **安全检查**: 硬编码 blocklist 查找 (~0.001ms/次)
4. **速率限制**: 内存 Map 查找 (~0.001ms/次)
5. **配额控制**: 异步接口但内存实现 (~0.01ms/次)

## 对比优势

### vs AgentScope (Python)

- **事件流**: RxJS Observable vs asyncio，TypeScript 编译优化
- **类型安全**: Zod 运行时验证 vs Python 类型提示
- **内存管理**: V8 引擎优化 vs Python GC

### vs DeepAgents (Python)

- **架构**: 纯事件流 vs LangGraph 状态图
- **中间件**: 无中间件开销 vs 8+ 层中间件栈
- **依赖**: 零外部依赖 vs LangChain 生态

### vs Mastra (TypeScript)

- **架构**: RxJS 事件流 vs Class-based DI
- **复杂度**: 1523 行核心 vs 5700 行 Agent 类
- **依赖**: 极简依赖 vs 94 个 provider

## 运行结果示例

```
================================================================================
BENCHMARK COMPARISON TABLE
================================================================================
Scenario             | AgentForge         | AgentScope         | DeepAgents        | Mastra
--------------------------------------------------------------------------------
Event Stream         | 0.12ms             | N/A                | N/A               | 0.45ms
Zod Validation       | 0.008ms            | N/A                | N/A               | 0.012ms
Security Check       | 0.001ms            | N/A                | N/A               | N/A
Rate Limit           | 0.0008ms           | N/A                | N/A               | N/A
Quota Check          | 0.009ms            | N/A                | N/A               | N/A
================================================================================
```

## 下一步

1. 在各框架环境中运行相同场景
2. 收集真实性能数据
3. 生成对比报告
4. 用于技术例会选型评估

## 注意事项

- 基准测试结果受硬件环境影响
- Python 框架需要在相同硬件上运行
- 内存测量需要多次运行取平均值
- 生产环境性能还需考虑网络、存储等因素
