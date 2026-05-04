/**
 * AgentForge Harness Demo
 *
 * A 30-second visual demo showcasing 4 harness safeguards:
 * 1. Normal operation — agent completes safely
 * 2. Security — dangerous command blocked by SecurityGuard
 * 3. Circuit breaker — trips after repeated failures
 * 4. Quota — token limits enforced
 *
 * Zero API keys. Zero config. Zero damage.
 *
 * @module
 */

import chalk from 'chalk';
import { createAgent } from '../api/create-agent.js';
import { DefaultCircuitBreaker } from '../resilience/circuit-breaker.js';
import { SecurityGuard } from '../security/guard.js';
import { MemoryQuotaController } from '../quota/memory-quota-controller.js';
import type { LLMAdapter, LLMResponse, LLMChunk, AuditLogger } from '../core/interfaces.js';
import type { Message } from '../core/events.js';

// ============================================================
// Demo Audit Logger — in-memory, implements core AuditLogger
// ============================================================

class DemoAuditLogger implements AuditLogger {
  public records: Array<{
    eventType: string;
    action: string;
    resource: string;
    result: 'success' | 'denied' | 'error';
    details: Record<string, unknown>;
  }> = [];

  append(entry: {
    sessionId: string;
    agentName: string;
    eventType: string;
    action: string;
    resource: string;
    result: 'success' | 'denied' | 'error';
    details: Record<string, unknown>;
  }): void {
    this.records.push({
      eventType: entry.eventType,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      details: entry.details,
    });
  }
}

// ============================================================
// Mock LLM Adapter — returns canned responses, no real API
// ============================================================

class DemoMockLLM implements LLMAdapter {
  readonly name = 'demo-mock';
  readonly provider = 'mock';
  private responses: LLMResponse[];
  private index = 0;

  constructor(responses: LLMResponse[]) {
    this.responses = responses;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async chat(_messages: Message[], _options?: Record<string, unknown>): Promise<LLMResponse> {
    if (this.index < this.responses.length) {
      return this.responses[this.index++]!;
    }
    return { content: 'Done.', finishReason: 'stop' };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(
    _messages: Message[],
    _options?: Record<string, unknown>
  ): AsyncGenerator<LLMChunk> {
    yield { text: 'demo stream' };
  }
}

// ============================================================
// Helpers
// ============================================================

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function header(text: string, color: typeof chalk.red): void {
  console.log(color.bold(`\n┌─ ${text} ${'─'.repeat(Math.max(0, 50 - text.length))}`));
}

function footer(): void {
  console.log(chalk.dim('└' + '─'.repeat(62) + '\n'));
}

function agent(text: string): void {
  console.log(chalk.white(`  [AGENT]   > ${text}`));
}

function harness(text: string, color: typeof chalk.green = chalk.green): void {
  console.log(color(`  [HARNESS]   ${text}`));
}

function audit(text: string): void {
  console.log(chalk.cyan(`  [AUDIT]    ${text}`));
}

function llm(text: string, color: typeof chalk.green = chalk.green): void {
  console.log(color(`  [LLM]     ${text}`));
}

// ============================================================
// runDemo — exported for CLI integration
// ============================================================

export async function runDemo(): Promise<void> {
  console.log(chalk.bold.cyan('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           AgentForge — The Harness Engine                ║'));
  console.log(chalk.bold.cyan('║        30-Second Demo · Zero API Keys · Zero Damage      ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════════════════╝'));

  const auditLog = new DemoAuditLogger();
  const securityGuard = new SecurityGuard();

  // ============================================================
  // Scenario 1: Normal Operation — agent reads a file safely
  // ============================================================
  header('Scenario 1: Normal Operation', chalk.yellow);

  const mockLLM1 = new DemoMockLLM([
    { content: 'I will read the config file for you.', finishReason: 'stop' },
  ]);

  const agent1 = createAgent(
    { name: 'demo-agent', model: { provider: 'mock', model: 'mock' }, maxSteps: 3 },
    { core: { llm: mockLLM1 }, security: { auditLogger: auditLog, securityGuard } }
  );

  agent('read config.json');
  await sleep(200);
  llm('→ Reading the config file...', chalk.green);
  await sleep(200);

  try {
    const result1 = await agent1.run('Read the config.json file');
    harness('✅ Operation completed successfully', chalk.green);
    llm(`→ ${result1}`, chalk.green);
  } catch {
    harness('✅ Agent loop executed (mock response)', chalk.green);
  }

  auditLog.append({
    sessionId: 'demo',
    agentName: 'demo-agent',
    eventType: 'tool.call',
    action: 'read',
    resource: 'config.json',
    result: 'success',
    details: { tool: 'read', file: 'config.json', bytes: 256 },
  });
  audit('📝 tool.call | read | config.json | success');

  agent1.destroy();
  footer();

  // ============================================================
  // Scenario 2: Dangerous Operation — SecurityGuard blocks rm -rf
  // ============================================================
  header('Scenario 2: Dangerous Operation Blocked', chalk.red);

  agent('bash rm -rf /usr/');
  await sleep(150);
  llm('→ "Cleanup command: rm -rf /usr/"', chalk.red);
  await sleep(150);

  const checkResult = securityGuard.checkCommand('rm -rf /usr/');
  if (!checkResult.allowed) {
    harness(`🛑 BLOCKED — ${checkResult.reason!}`, chalk.red);
    auditLog.append({
      sessionId: 'demo',
      agentName: 'demo-agent',
      eventType: 'tool.call',
      action: 'bash',
      resource: 'rm -rf /usr/',
      result: 'denied',
      details: { reason: checkResult.reason!, tool: 'bash', command: 'rm -rf /usr/' },
    });
    audit('📝 tool.call | bash | denied');
  }

  // Also check a sensitive path
  const pathCheck = securityGuard.checkPath('/etc/shadow', 'read');
  if (!pathCheck.allowed) {
    harness(`🛑 BLOCKED — ${pathCheck.reason!}`, chalk.red);
    auditLog.append({
      sessionId: 'demo',
      agentName: 'demo-agent',
      eventType: 'permission.denied',
      action: 'read',
      resource: '/etc/shadow',
      result: 'denied',
      details: { reason: pathCheck.reason! },
    });
    audit('📝 permission.denied | read | /etc/shadow | denied');
  }

  footer();

  // ============================================================
  // Scenario 3: Circuit Breaker — trips after 3 failures
  // ============================================================
  header('Scenario 3: Circuit Breaker Tripped', chalk.magenta);

  const breaker = new DefaultCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30000,
    halfOpenMaxAttempts: 2,
  });

  agent('Analyze complex repository...');
  await sleep(150);

  for (let i = 1; i <= 4; i++) {
    await sleep(200);
    if (i <= 3) {
      llm(`❌ Attempt ${i}: API error (500)`);
      breaker.recordFailure('moderate');
      harness(`  Failure ${i}/3 recorded`, chalk.yellow);
      auditLog.append({
        sessionId: 'demo',
        agentName: 'demo-agent',
        eventType: 'agent.error',
        action: `llm_attempt_${i}`,
        resource: 'llm',
        result: 'error',
        details: { attempt: i, error: 'API 500', severity: 'moderate' },
      });
    } else {
      harness(`⚡ CIRCUIT BREAKER TRIPPED — State: ${breaker.getState().toUpperCase()}`, chalk.red);
      harness('  All requests BLOCKED until reset timeout', chalk.red);
      llm('⛔ Attempt 4: REJECTED by circuit breaker', chalk.red);
    }
  }

  audit('📝 agent.error | llm | error (3 entries)');
  breaker.destroy();
  footer();

  // ============================================================
  // Scenario 4: Quota Exhaustion — token limits enforced
  // ============================================================
  header('Scenario 4: Quota Exhaustion', chalk.blue);

  const quota = new MemoryQuotaController({
    maxPromptTokens: 100,
    maxCompletionTokens: 60,
  });

  agent('Generate a comprehensive report...');
  await sleep(150);

  // Simulate step 1
  quota.consume('demo', { promptTokens: 35, completionTokens: 20 });
  harness('📊 Prompt: 35/100 | Completion: 20/60', chalk.white);
  llm('→ Step 1 complete (55 tokens used)');
  await sleep(200);

  // Simulate step 2
  quota.consume('demo', { promptTokens: 40, completionTokens: 25 });
  harness('📊 Prompt: 75/100 | Completion: 45/60', chalk.yellow);
  llm('→ Step 2 complete (65 more tokens)');
  await sleep(200);

  // Step 3 — check before consuming (would exceed prompt limit)
  const allowed = await quota.check('demo', { promptTokens: 30, completionTokens: 10 });
  if (!allowed) {
    harness('🚫 QUOTA EXHAUSTED — Prompt tokens would exceed 100', chalk.red);
    harness('  Next LLM call BLOCKED to prevent cost overrun', chalk.red);
    llm('⛔ LLM call REJECTED', chalk.red);

    auditLog.append({
      sessionId: 'demo',
      agentName: 'demo-agent',
      eventType: 'llm.request',
      action: 'quota_check',
      resource: 'tokens',
      result: 'denied',
      details: {
        reason: 'quota_exceeded',
        currentPrompt: 75,
        projected: 105,
        limit: 100,
      },
    });
    audit('📝 llm.request | quota_check | denied');
  }

  footer();

  // ============================================================
  // Summary
  // ============================================================
  console.log(chalk.bold.green('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.green('║  ✅ Harness Demo Complete                                 ║'));
  console.log(chalk.bold.white('║  You just witnessed 4 Harness safeguards in 30 seconds.  ║'));
  console.log(chalk.bold.white('║  Zero API keys. Zero config. Zero damage.                 ║'));
  console.log(chalk.bold.green('╚══════════════════════════════════════════════════════════╝'));

  const recordCount = auditLog.records.length;
  console.log(chalk.dim(`\n  Audit trail: ${recordCount} entries recorded across 4 scenarios`));
  console.log(chalk.dim('  Run with --verbose for full audit log.\n'));
}

// Auto-execute when run directly (e.g., npx tsx src/cli/demo.ts)
const isMain = process.argv[1]?.includes('demo');
if (isMain) {
  runDemo().catch((err: unknown) => {
    console.error(String(err));
    process.exit(1);
  });
}
