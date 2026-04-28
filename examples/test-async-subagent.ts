/**
 * 真实示例：测试 Compiled/Async 子代理
 *
 * 运行方式：npx tsx examples/test-async-subagent.ts
 */

import { SubagentRegistry, createSubagentRegistry } from '../src/subagent/registry.js';
import type { AgentLoop, AsyncSubagentHandle } from '../src/subagent/types.js';
import { Observable, of, EMPTY, delay } from 'rxjs';
import type { AgentEvent } from '../src/core/events.js';

console.log('✅ SubagentRegistry 导入成功');

// 创建一个模拟的 Agent Loop
function createMockAgentLoop(name: string, delayMs: number = 100): AgentLoop {
  return {
    run: (input: string) => {
      console.log(`  [${name}] 开始执行，输入: ${input}`);

      return new Observable<AgentEvent>(subscriber => {
        // 模拟延迟执行
        setTimeout(() => {
          subscriber.next({
            type: 'agent.start',
            timestamp: Date.now(),
            sessionId: `session-${name}`,
            input,
            agentName: name,
            model: { provider: 'openai', model: 'gpt-4o' },
          });

          subscriber.next({
            type: 'agent.complete',
            timestamp: Date.now(),
            sessionId: `session-${name}`,
            output: `${name} 完成了任务: ${input}`,
            steps: 1,
          });

          subscriber.next({
            type: 'done',
            timestamp: Date.now(),
            sessionId: `session-${name}`,
            reason: 'stop',
          });

          subscriber.complete();
        }, delayMs);
      });
    },
    destroy$: EMPTY,
  };
}

// 测试 1: 同步模式
async function testSyncMode() {
  console.log('\n📝 测试 1: 同步模式');

  const registry = createSubagentRegistry();

  registry.register({
    name: 'sync-agent',
    description: '同步子代理',
    agent: createMockAgentLoop('sync-agent', 50),
    mode: 'subagent',
  });

  const events: AgentEvent[] = [];

  await new Promise<void>(resolve => {
    registry.run('sync-agent', '测试同步任务').subscribe({
      next: event => {
        events.push(event);
        console.log(`  收到事件: ${event.type}`);
      },
      complete: () => {
        console.log('  流完成');
        resolve();
      },
    });
  });

  if (events.length > 0) {
    console.log('✅ 同步模式测试成功，共收到', events.length, '个事件');
  } else {
    console.error('❌ 同步模式测试失败');
  }
}

// 测试 2: Async 模式
async function testAsyncMode() {
  console.log('\n📝 测试 2: Async 模式');

  const registry = createSubagentRegistry();

  registry.register({
    name: 'async-agent',
    description: '异步子代理',
    agent: createMockAgentLoop('async-agent', 200),
    mode: 'subagent',
    executionMode: 'async',
    asyncConfig: {
      onComplete: result => {
        console.log('  [回调] 任务完成:', result.status);
      },
    },
  });

  const events: AgentEvent[] = [];

  await new Promise<void>(resolve => {
    registry.run('async-agent', '测试异步任务').subscribe({
      next: event => {
        events.push(event);
        console.log(`  收到事件: ${event.type}`);

        if (event.type === 'subagent.start') {
          console.log('  子代理启动，Session ID:', event.sessionId);

          // 获取句柄
          const handle = registry.getAsyncHandle(event.sessionId);
          if (handle) {
            console.log('  获取到句柄，Session ID:', handle.sessionId);
          }
        }
      },
      complete: () => {
        console.log('  流完成（只收到 subagent.start 事件）');
        resolve();
      },
    });
  });

  // 等待异步任务完成
  console.log('  等待异步任务完成...');
  await new Promise(resolve => setTimeout(resolve, 300));

  if (events.length === 1 && events[0]?.type === 'subagent.start') {
    console.log('✅ Async 模式测试成功，立即返回 subagent.start 事件');
  } else {
    console.error('❌ Async 模式测试失败');
  }
}

// 测试 3: Async 模式取消
async function testAsyncCancel() {
  console.log('\n📝 测试 3: Async 模式取消');

  const registry = createSubagentRegistry();

  registry.register({
    name: 'cancel-agent',
    description: '可取消的子代理',
    agent: createMockAgentLoop('cancel-agent', 500), // 500ms 延迟
    mode: 'subagent',
    executionMode: 'async',
    asyncConfig: {
      onComplete: () => {
        console.log('  [回调] 任务完成（不应该被调用）');
      },
    },
  });

  let sessionId = '';

  await new Promise<void>(resolve => {
    registry.run('cancel-agent', '测试取消任务').subscribe({
      next: event => {
        if (event.type === 'subagent.start') {
          sessionId = event.sessionId;
          console.log('  子代理启动，Session ID:', sessionId);
        }
      },
      complete: () => resolve(),
    });
  });

  // 立即取消
  const handle = registry.getAsyncHandle(sessionId);
  if (handle) {
    console.log('  取消任务...');
    await handle.cancel();

    // 验证句柄已移除
    const handleAfterCancel = registry.getAsyncHandle(sessionId);
    if (!handleAfterCancel) {
      console.log('✅ 取消成功，句柄已移除');
    } else {
      console.error('❌ 取消失败，句柄仍然存在');
    }
  } else {
    console.error('❌ 无法获取句柄');
  }
}

// 测试 4: Compiled 模式
async function testCompiledMode() {
  console.log('\n📝 测试 4: Compiled 模式');

  const registry = createSubagentRegistry();

  registry.register({
    name: 'compiled-agent',
    description: '编译的子代理',
    agent: createMockAgentLoop('compiled-agent', 50),
    mode: 'subagent',
    executionMode: 'compiled',
    compiledConfig: {
      model: { provider: 'openai', model: 'gpt-4o' },
      tools: ['read_file', 'write_file'],
      systemPrompt: '你是一个代码助手',
      maxSteps: 5,
    },
  });

  const events: AgentEvent[] = [];

  await new Promise<void>(resolve => {
    registry.run('compiled-agent', '测试编译任务').subscribe({
      next: event => {
        events.push(event);
        console.log(`  收到事件: ${event.type}`);
      },
      complete: () => {
        console.log('  流完成');
        resolve();
      },
    });
  });

  if (events.length > 0) {
    console.log('✅ Compiled 模式测试成功，共收到', events.length, '个事件');
  } else {
    console.error('❌ Compiled 模式测试失败');
  }
}

// 测试 5: 错误处理
async function testErrorHandling() {
  console.log('\n📝 测试 5: 错误处理');

  const registry = createSubagentRegistry();

  // 注册一个不存在的子代理
  const events: AgentEvent[] = [];

  await new Promise<void>(resolve => {
    registry.run('non-existent-agent', '测试错误').subscribe({
      next: event => {
        events.push(event);
        console.log(`  收到事件: ${event.type}`);
      },
      complete: () => {
        console.log('  流完成');
        resolve();
      },
    });
  });

  if (events.length > 0 && events[0]?.type === 'subagent.error') {
    console.log('✅ 错误处理测试成功');
  } else {
    console.error('❌ 错误处理测试失败');
  }
}

// 运行所有测试
async function runAllTests() {
  try {
    await testSyncMode();
    await testAsyncMode();
    await testAsyncCancel();
    await testCompiledMode();
    await testErrorHandling();

    console.log('\n🎉 所有测试完成！');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

runAllTests();
