# 上下文扩展和安全中间件 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 `src/context.ts` 支持完整请求上下文信息，并添加轻量级安全中间件提供 PII 检测和 prompt 注入防护，创建 `THREAT_MODEL.md` 安全文档。

**Architecture:** 保持向后兼容扩展上下文接口，新增独立安全中间件文件遵循现有中间件架构模式，使用轻量级正则匹配实现零依赖安全检测。安全文档保持简洁只覆盖核心威胁。

**Tech Stack:** TypeScript, RxJS, 纯正则匹配（无额外依赖）

---

## Chunk 1: 上下文扩展

### Task 1: 扩展 `src/context.ts`

**Files:**

- Modify: `src/context.ts`
- Test: 无单独测试（被其他模块间接测试，保持兼容性）

- [ ] **Step 1: Update the CurrentContext interface**

```typescript
interface CurrentContext {
  messages: Message[];
  sessionId?: string;
  userId?: string;
  tenantId?: string;
  requestId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 2: 编译检查类型正确**

Run: `npm run build` (or `tsc --noEmit`)
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/context.ts
git commit -m "feat(context): extend CurrentContext with full request fields"
```

## Chunk 2: 安全中间件实现

### Task 2: 创建安全中间件文件

**Files:**

- Create: `src/middleware/security.middleware.ts`
- Modify: `src/middleware/index.ts`
- Create: `tests/middleware/security.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/middleware/security.test.ts`:

```typescript
import { createSecurityMiddleware } from '../../src/middleware/security.middleware';
import { of } from 'rxjs';
import type { StreamEvent } from '../../src/types';

describe('security middleware', () => {
  describe('PII detection', () => {
    it('should redact email addresses', () => {
      const middleware = createSecurityMiddleware({
        pii: { enabled: true, action: 'redact' },
      });

      const input$ = of<StreamEvent>({
        type: 'content',
        content: 'Contact me at test@example.com',
      });

      let resultContent: string | undefined;
      const result$ = middleware(input$);

      result$.subscribe((event) => {
        resultContent = event.content;
      });

      expect(resultContent).not.toContain('test@example.com');
      expect(resultContent).toContain('[REDACTED]');
    });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `npm test tests/middleware/security.test.ts`
Expected: FAIL - "Cannot find module '.../security.middleware'"

- [ ] **Step 3: Implement security middleware**

Create `src/middleware/security.middleware.ts`:

```typescript
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Middleware } from './index.js';
import type { StreamEvent } from '../types.js';
import { ValidationError } from '../errors/index.js';
import { logger } from '../logger/index.js';

export interface SecurityMiddlewareOptions {
  pii?: {
    enabled: boolean;
    action: 'redact' | 'block';
  };
  promptInjection?: {
    enabled: boolean;
    action: 'block' | 'warn';
    keywords?: string[];
  };
}

// PII detection patterns
const PII_PATTERNS = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phoneCN: /(?:\+?86)?1[3-9]\d{9}/g,
  creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  idCardCN: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
};

// Default prompt injection detection keywords
const DEFAULT_INJECTION_KEYWORDS = [
  'ignore previous instructions',
  'forget all instructions',
  'disregard previous',
  'you are now',
  'from now on you are',
  'system prompt',
  'change your instructions',
  'new instructions',
];

const defaultOptions: Required<SecurityMiddlewareOptions> = {
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

export function createSecurityMiddleware(options: SecurityMiddlewareOptions = {}): Middleware {
  const config = {
    ...defaultOptions,
    ...options,
    pii: { ...defaultOptions.pii, ...options.pii },
    promptInjection: { ...defaultOptions.promptInjection, ...options.promptInjection },
  };

  return (source$: Observable<StreamEvent>) => {
    return source$.pipe(
      map((event) => {
        let content = event.content;
        if (!content) return event;

        // PII detection and processing
        if (config.pii.enabled) {
          let hasPii = false;
          for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
            if (pattern.test(content)) {
              hasPii = true;
              if (config.pii.action === 'block') {
                throw new ValidationError(`PII (${type}) detected and blocked`);
              } else if (config.pii.action === 'redact') {
                content = content.replace(pattern, '[REDACTED]');
              }
            }
          }
          if (hasPii) {
            logger.debug('[security] PII redacted from content');
          }
        }

        // Prompt injection detection
        if (config.promptInjection.enabled) {
          const contentLower = content.toLowerCase();
          const detectedKeywords = config.promptInjection.keywords.filter((keyword) =>
            contentLower.includes(keyword.toLowerCase())
          );

          if (detectedKeywords.length > 0) {
            const message = `Possible prompt injection detected: matched keywords: ${detectedKeywords.join(', ')}`;
            if (config.promptInjection.action === 'block') {
              throw new ValidationError(message);
            } else if (config.promptInjection.action === 'warn') {
              logger.warn(`[security] ${message}`);
            }
          }
        }

        return { ...event, content };
      })
    );
  };
}
```

- [ ] **Step 4: Export from middleware index**

Modify `src/middleware/index.ts`, add:

```typescript
export { createSecurityMiddleware } from './security.middleware';
export type { SecurityMiddlewareOptions } from './security.middleware';
```

- [ ] **Step 5: Run tests to check they pass**

Run: `npm test tests/middleware/security.test.ts`
Expected: PASS for basic tests

- [ ] **Step 6: Commit**

```bash
git add src/middleware/security.middleware.ts src/middleware/index.ts tests/middleware/security.test.ts
git commit -m "feat(middleware): add security middleware with PII and prompt injection detection"
```

### Task 3: Add comprehensive tests for security middleware

**Files:**

- Modify: `tests/middleware/security.test.ts`

- [ ] **Step 1: Add more test cases**

Add tests for:

- Phone number detection and redaction
- Credit card detection
- Block behavior when configured
- Prompt injection detection with warn/block
- Disabled features pass through content unchanged

- [ ] **Step 2: Run all tests to confirm they pass**

Run: `npm test tests/middleware/security.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/middleware/security.test.ts
git commit -m "test(middleware): add comprehensive tests for security middleware"
```

## Chunk 3: THREAT_MODEL.md 文档

### Task 4: 创建根目录 THREAT_MODEL.md

**Files:**

- Create: `THREAT_MODEL.md` at project root

- [ ] **Step 1: Write threat modeling document**

Content:

```markdown
# Threat Model for AgentForge

This document outlines the primary security threats considered in AgentForge design and the mitigation strategies currently in place.

## 1. Prompt Injection

**Threat:** Attackers manipulate the LLM into ignoring original instructions and following attacker-controlled instructions. This can lead to unexpected behavior, information disclosure, or privilege escalation.

**Mitigation:**

- Built-in prompt injection detection via keywords in the security middleware
- Detection can be configured to warn or block
- Further mitigation: Use clear instruction boundaries in system prompts, follow LLM prompt engineering best practices

## 2. Path Traversal Attacks

**Threat:** Malicious tool inputs could attempt to access files outside the allowed working directory, potentially exposing sensitive system files or credentials.

**Mitigation:**

- Sandbox policy enforces allowed/denied path checking (`src/sandbox/policy.ts`)
- Default deny list includes common credential locations (`.ssh`, `.aws`, `.env` files, etc.)
- All paths are normalized and checked before any filesystem access

## 3. Sensitive Information Leakage

**Threat:** User inputs or LLM outputs may contain PII (personal identifiable information) or other sensitive data that should not be logged or persisted.

**Mitigation:**

- Security middleware provides built-in PII detection
- PII can be automatically redacted from content before logging/storage
- Configurable policies: redact or block based on requirements

## 4. Tool Abuse

**Threat:** LLMs may misuse enabled tools in unexpected ways, potentially causing unintended side effects (e.g., deleting files, installing malware).

**Mitigation:**

- Sandbox execution environment with configurable timeout and output limits
- User approval middleware (`hitl`) available for high-risk operations
- It is the agent developer's responsibility to enable only necessary tools and configure appropriate policies

## 5. Supply Chain Attacks

**Threat:** Third-party plugins or dependencies could contain malicious code.

**Mitigation:**

- No current mitigation beyond standard dependency review
- Users should vet third-party plugins before use

## Reporting Security Issues

If you discover a security vulnerability, please report it via GitHub Issues.
```

- [ ] **Step 2: Review file**

Verify content matches minimal scope (only core threats) as designed

- [ ] **Step 3: Commit**

```bash
git add THREAT_MODEL.md
git commit -m "docs: add THREAT_MODEL.md with core security threats and mitigations"
```

## Chunk 4: 验证整体构建和测试

### Task 5: 全量测试和构建检查

- [ ] **Step 1: Run all middleware tests**

Run: `npm test tests/middleware/`
Expected: All tests pass

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Verify no breaking changes**

Run: All existing tests still pass: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit (if any fixes needed)**

If fixes needed, commit changes.

---
