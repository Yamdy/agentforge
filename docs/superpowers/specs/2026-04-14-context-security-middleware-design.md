# 上下文扩展和安全中间件 - 设计文档

## 概述

本次实现补强 agentforge 的两个核心能力：

1. **上下文扩展** - 扩展 `src/context.ts` 支持完整的请求追踪信息
2. **安全中间件** - 添加轻量级内置 PII 检测和 prompt 注入防护
3. **THREAT_MODEL.md** - 记录核心安全威胁和缓解措施

## 背景

参考 DeepAgents 和 Mastra 框架，agentforge 需要补强生产环境所需的安全和可观测性基础能力。当前上下文只包含 `messages` 和 `sessionId`，缺少请求追踪所需的完整信息；同时缺少内置的内容安全检测能力。

## 设计决策

### 1. 上下文扩展设计

#### 接口定义

```typescript
interface CurrentContext {
  messages: Message[]; // 现有字段，保持不变
  sessionId?: string; // 现有字段，保持不变
  userId?: string; // 新增：用户标识
  tenantId?: string; // 新增：租户标识（预留接口，不需要多租户也保留）
  requestId?: string; // 新增：请求唯一标识
  traceId?: string; // 新增：分布式追踪标识
  metadata?: Record<string, unknown>; // 新增：通用元数据，灵活扩展
}
```

#### API 保持向后兼容

- 现有函数 `setCurrentMemory()`, `getCurrentMemory()`, `clearCurrentMemory()` 保持不变
- 新增字段都是可选的，不破坏现有代码
- 用户不需要使用新字段时，行为和之前完全一致

### 2. 安全中间件设计

#### 功能范围

- **PII 检测**：轻量级内置正则检测，识别常见个人可识别信息
  - 电子邮箱
  - 中国大陆手机号
  - 信用卡号（Luhn 算法验证）
  - 中国大陆身份证号
- **Prompt 注入检测**：基于关键词匹配检测常见注入尝试
- **处理策略**：支持 `redact`（脱敏替换）和 `block`（阻止请求）两种方式
- **依赖**：零额外依赖，纯正则匹配，保持轻量级

#### 配置接口

```typescript
export interface SecurityMiddlewareOptions {
  pii?: {
    enabled: boolean;
    action: 'redact' | 'block';
  };
  promptInjection?: {
    enabled: boolean;
    action: 'block' | 'warn';
    keywords?: string[]; // 可自定义关键词，默认提供基础列表
  };
}
```

#### 默认配置

```typescript
const defaultOptions: SecurityMiddlewareOptions = {
  pii: {
    enabled: true,
    action: 'redact',
  },
  promptInjection: {
    enabled: true,
    action: 'warn',
    keywords: DEFAULT_INJECTION_KEYWORDS,
  },
};
```

### 3. THREAT_MODEL.md 设计

文档只覆盖核心安全威胁，保持简洁：

1. **Prompt 注入** - 描述威胁 + 当前缓解措施（关键词检测）
2. **路径遍历攻击** - 描述威胁 + 当前缓解措施（sandbox policy 已防护）
3. **敏感信息泄露** - 描述威胁 + 当前缓解措施（PII 检测脱敏）
4. **工具滥用** - 描述威胁 + 当前缓解措施（沙箱权限控制）

## 集成点

1. **`src/context.ts`** - 扩展接口，无 breaking changes
2. **`src/middleware/security.middleware.ts`** - 新增文件
3. **`src/middleware/index.ts`** - 导出新中间件工厂函数
4. **`THREAT_MODEL.md`** - 新增文件放在项目根目录

## 错误处理

- PII 检测到且配置为 `block` 时，抛出 `ValidationError`
- Prompt 注入检测到且配置为 `block` 时，抛出 `ValidationError`
- 配置为 `warn` 时，只记录日志不阻止请求
- 所有检测失败默认降级为不处理，不影响正常请求

## 测试计划

- `tests/middleware/security.test.ts` - 单元测试覆盖各检测场景
- 测试 PII 检测的各种匹配情况
- 测试不同处理策略（redact/block/warn）
- 测试向后兼容性，确保现有代码不被破坏

## 作者

Date: 2026-04-14
Author: opencode
