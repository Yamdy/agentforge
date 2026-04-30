/**
 * AgentForge 可观测性示例
 *
 * 展示如何使用 ResourceMonitor 进行资源监控和指标收集。
 *
 * 运行方式: npx tsx examples/10-observability.ts
 */

import { ResourceMonitor, type ResourceMetrics, type ResourcePressure } from '../src/observability/index.js';
import type { AgentEvent } from '../src/core/events.js';

// ============================================================
// 辅助函数：创建模拟事件流
// ============================================================

const sessionId = 'monitor-session-001';
const baseTimestamp = Date.now();

/** 创建模拟 Agent 事件流 (返回数组) */
function createMockAgentEvents(): AgentEvent[] {
  return [
    {
      type: 'agent.start',
      timestamp: baseTimestamp,
      sessionId,
      input: '执行资源密集型任务',
      agentName: 'resource-agent',
      model: { provider: 'openai', model: 'gpt-4' },
    },
    {
      type: 'agent.step',
      timestamp: baseTimestamp + 100,
      sessionId,
      step: 1,
      maxSteps: 5,
    },
    {
      type: 'llm.request',
      timestamp: baseTimestamp + 150,
      sessionId,
      messages: [{ role: 'user', content: '处理大数据' }],
      model: { provider: 'openai', model: 'gpt-4' },
    },
    {
      type: 'llm.response',
      timestamp: baseTimestamp + 2000,
      sessionId,
      content: '处理完成',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50 },
    },
    {
      type: 'agent.complete',
      timestamp: baseTimestamp + 2500,
      sessionId,
      output: '任务完成',
      steps: 1,
      tokens: { input: 100, output: 50 },
    },
    {
      type: 'done',
      timestamp: baseTimestamp + 2600,
      sessionId,
      reason: 'stop',
    },
  ];
}

// ============================================================
// 示例 1: 基本资源监控
// ============================================================

function example1_basicResourceMonitoring(): void {
  console.log('\n=== 示例 1: 基本资源监控 ===\n');

  // 创建资源监控器（每 100ms 采集一次，用于演示）
  const monitor = new ResourceMonitor({
    intervalMs: 100,
    memoryWarningThreshold: 0.7,
    memoryCriticalThreshold: 0.9,
  });

  // 获取单次快照
  const snapshot = monitor.snapshot();

  console.log('--- 资源快照 ---');
  console.log(`时间戳: ${new Date(snapshot.timestamp).toISOString()}`);
  console.log(`运行时间: ${(snapshot.uptime / 1000).toFixed(2)} 秒`);
  console.log(`堆内存使用: ${(snapshot.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`堆内存总量: ${(snapshot.memory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS: ${(snapshot.memory.rss / 1024 / 1024).toFixed(2)} MB`);

  if (snapshot.cpu) {
    console.log(`CPU 用户态: ${(snapshot.cpu.user / 1000).toFixed(2)} ms`);
    console.log(`CPU 内核态: ${(snapshot.cpu.system / 1000).toFixed(2)} ms`);
  }

  if (snapshot.eventLoopDelay !== undefined) {
    console.log(`事件循环延迟: ${snapshot.eventLoopDelay.toFixed(3)} ms`);
  }
}

// ============================================================
// 示例 2: 内存压力检测
// ============================================================

function example2_memoryPressureDetection(): void {
  console.log('\n=== 示例 2: 内存压力检测 ===\n');

  const monitor = new ResourceMonitor({
    memoryWarningThreshold: 0.7,
    memoryCriticalThreshold: 0.9,
  });

  // 获取当前指标
  const metrics = monitor.collect();
  const pressure = monitor.getPressure(metrics);
  const usage = monitor.getMemoryUsage(metrics);

  console.log(`内存使用率: ${(usage * 100).toFixed(1)}%`);
  console.log(`压力等级: ${pressure}`);

  // 根据压力等级采取行动
  switch (pressure) {
    case 'normal':
      console.log('✅ 系统资源正常');
      break;
    case 'warning':
      console.log('⚠️ 内存使用接近阈值，建议关注');
      break;
    case 'critical':
      console.log('🚨 内存压力过高，需要立即处理！');
      break;
  }

  // 使用格式化输出
  console.log(`\n格式化输出: ${monitor.format(metrics)}`);
}

// ============================================================
// 示例 3: 持续监控 (callback 模式)
// ============================================================

function example3_continuousMonitoring(): void {
  console.log('\n=== 示例 3: 持续监控 (callback 模式) ===\n');

  const monitor = new ResourceMonitor({
    intervalMs: 200, // 每 200ms 采集一次
  });

  let sampleCount = 0;
  const maxSamples = 5;

  // 使用 setInterval 进行持续监控
  const intervalId = setInterval(() => {
    sampleCount++;
    const metrics = monitor.collect();
    const pressure = monitor.getPressure(metrics);
    const usage = (monitor.getMemoryUsage(metrics) * 100).toFixed(1);
    console.log(`[${new Date(metrics.timestamp).toLocaleTimeString()}] 内存: ${usage}% | 压力: ${pressure}`);

    if (sampleCount >= maxSamples) {
      clearInterval(intervalId);
      console.log('监控完成（已采集 5 次样本）');
    }
  }, 200);
}

// ============================================================
// 示例 4: 与 Agent 事件流集成
// ============================================================

function example4_agentIntegration(): void {
  console.log('\n=== 示例 4: 与 Agent 事件流集成 ===\n');

  const monitor = new ResourceMonitor();
  const events = createMockAgentEvents();
  const results: Array<{ event: AgentEvent; metrics: ResourceMetrics }> = [];

  // 遍历事件并收集指标
  for (const event of events) {
    const metrics = monitor.collect();
    results.push({ event, metrics });
  }

  console.log(`处理了 ${results.length} 个事件及其资源指标`);

  // 分析资源使用趋势
  const memoryUsages = results.map(r => r.metrics.memory.heapUsed);
  const minMem = Math.min(...memoryUsages);
  const maxMem = Math.max(...memoryUsages);

  console.log(`内存使用范围: ${(minMem / 1024 / 1024).toFixed(2)} MB - ${(maxMem / 1024 / 1024).toFixed(2)} MB`);

  // 打印每个事件的压力状态
  results.forEach((r, i) => {
    const pressure = monitor.getPressure(r.metrics);
    console.log(`  事件 ${i + 1}: ${r.event.type} -> 压力: ${pressure}`);
  });
}

// ============================================================
// 示例 5: 性能分析
// ============================================================

interface PerformanceRecord {
  operation: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
}

/**
 * 简单的性能分析器
 */
class PerformanceProfiler {
  private readonly monitor: ResourceMonitor;
  private readonly records: PerformanceRecord[] = [];

  constructor(monitor: ResourceMonitor) {
    this.monitor = monitor;
  }

  /** 测量操作性能 */
  measure<T>(operation: string, fn: () => T): T {
    const memoryBefore = this.monitor.collect().memory.heapUsed;
    const startTime = Date.now();

    const result = fn();

    const endTime = Date.now();
    const memoryAfter = this.monitor.collect().memory.heapUsed;

    this.records.push({
      operation,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      memoryBefore,
      memoryAfter,
      memoryDelta: memoryAfter - memoryBefore,
    });

    return result;
  }

  /** 异步测量 */
  async measureAsync<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const memoryBefore = this.monitor.collect().memory.heapUsed;
    const startTime = Date.now();

    const result = await fn();

    const endTime = Date.now();
    const memoryAfter = this.monitor.collect().memory.heapUsed;

    this.records.push({
      operation,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      memoryBefore,
      memoryAfter,
      memoryDelta: memoryAfter - memoryBefore,
    });

    return result;
  }

  /** 获取所有记录 */
  getRecords(): readonly PerformanceRecord[] {
    return this.records;
  }

  /** 打印报告 */
  printReport(): void {
    console.log('\n--- 性能分析报告 ---\n');
    console.log('操作'.padEnd(30), '耗时(ms)'.padStart(10), '内存变化(KB)'.padStart(15));
    console.log('-'.repeat(60));

    this.records.forEach(record => {
      const memDeltaKB = (record.memoryDelta / 1024).toFixed(2);
      console.log(
        record.operation.padEnd(30),
        record.durationMs.toString().padStart(10),
        memDeltaKB.padStart(15)
      );
    });

    const totalDuration = this.records.reduce((sum, r) => sum + r.durationMs, 0);
    const avgDuration = totalDuration / this.records.length;

    console.log('-'.repeat(60));
    console.log(`总计: ${this.records.length} 个操作, 总耗时: ${totalDuration}ms, 平均: ${avgDuration.toFixed(2)}ms`);
  }
}

function example5_performanceProfiling(): void {
  console.log('\n=== 示例 5: 性能分析 ===\n');

  const monitor = new ResourceMonitor();
  const profiler = new PerformanceProfiler(monitor);

  // 模拟几个操作
  profiler.measure('初始化数组', () => {
    const arr: number[] = [];
    for (let i = 0; i < 10000; i++) {
      arr.push(i);
    }
    return arr;
  });

  profiler.measure('数组映射操作', () => {
    const arr = profiler.getRecords()[0] ? [] : Array.from({ length: 10000 }, (_, i) => i);
    return arr.map(x => x * 2);
  });

  profiler.measure('JSON 序列化', () => {
    const data = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })) };
    return JSON.stringify(data);
  });

  profiler.measure('JSON 解析', () => {
    const json = JSON.stringify({ data: Array.from({ length: 1000 }, (_, i) => i) });
    return JSON.parse(json);
  });

  profiler.printReport();
}

// ============================================================
// 示例 6: 自定义指标聚合
// ============================================================

interface AggregatedMetrics {
  samples: number;
  avgMemoryMB: number;
  maxMemoryMB: number;
  minMemoryMB: number;
  avgCpuUserMs: number;
  totalCpuUserMs: number;
  pressureDistribution: Record<ResourcePressure, number>;
}

/**
 * 聚合多个指标样本
 */
function aggregateMetrics(
  monitor: ResourceMonitor,
  metricsList: ResourceMetrics[]
): AggregatedMetrics {
  const memoryValues = metricsList.map(m => m.memory.heapUsed);

  // 计算 CPU 指标（如果可用）
  const cpuValues = metricsList
    .map(m => m.cpu?.user)
    .filter((v): v is number => v !== undefined);

  // 计算压力分布
  const pressureDistribution: Record<ResourcePressure, number> = {
    normal: 0,
    warning: 0,
    critical: 0,
  };

  metricsList.forEach(m => {
    const pressure = monitor.getPressure(m);
    pressureDistribution[pressure]++;
  });

  return {
    samples: metricsList.length,
    avgMemoryMB: (memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length) / 1024 / 1024,
    maxMemoryMB: Math.max(...memoryValues) / 1024 / 1024,
    minMemoryMB: Math.min(...memoryValues) / 1024 / 1024,
    avgCpuUserMs: cpuValues.length > 0
      ? (cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length) / 1000
      : 0,
    totalCpuUserMs: cpuValues.length > 0
      ? cpuValues.reduce((a, b) => a + b, 0) / 1000
      : 0,
    pressureDistribution,
  };
}

function example6_customAggregation(): void {
  console.log('\n=== 示例 6: 自定义指标聚合 ===\n');

  const monitor = new ResourceMonitor();

  // 收集多个样本
  const samples: ResourceMetrics[] = [];

  // 模拟收集 10 个样本
  for (let i = 0; i < 10; i++) {
    // 模拟一些内存分配
    const temp: number[] = [];
    for (let j = 0; j < 10000 * (i + 1); j++) {
      temp.push(j);
    }
    samples.push(monitor.collect());
  }

  // 聚合分析
  const aggregated = aggregateMetrics(monitor, samples);

  console.log('--- 聚合指标报告 ---');
  console.log(`样本数量: ${aggregated.samples}`);
  console.log(`平均内存: ${aggregated.avgMemoryMB.toFixed(2)} MB`);
  console.log(`最大内存: ${aggregated.maxMemoryMB.toFixed(2)} MB`);
  console.log(`最小内存: ${aggregated.minMemoryMB.toFixed(2)} MB`);
  console.log(`平均 CPU 用户态: ${aggregated.avgCpuUserMs.toFixed(2)} ms`);
  console.log(`总 CPU 用户态: ${aggregated.totalCpuUserMs.toFixed(2)} ms`);
  console.log(`压力分布:`);
  console.log(`  - 正常: ${aggregated.pressureDistribution.normal}`);
  console.log(`  - 警告: ${aggregated.pressureDistribution.warning}`);
  console.log(`  - 危急: ${aggregated.pressureDistribution.critical}`);
}

// ============================================================
// 示例 7: 资源预警系统
// ============================================================

interface Alert {
  timestamp: number;
  pressure: ResourcePressure;
  message: string;
  metrics: ResourceMetrics;
}

/**
 * 资源预警系统 (使用 setInterval 替代 Observable)
 */
class ResourceAlertSystem {
  private readonly monitor: ResourceMonitor;
  private readonly alerts: Alert[] = [];
  private intervalId: ReturnType<typeof setInterval> | undefined;

  constructor(
    options: {
      monitor: ResourceMonitor;
      onAlert?: (alert: Alert) => void;
    }
  ) {
    this.monitor = options.monitor;
    this.onAlert = options.onAlert;
  }

  private readonly onAlert?: (alert: Alert) => void;

  /** 启动监控 */
  start(intervalMs: number = 1000): void {
    this.intervalId = setInterval(() => {
      const metrics = this.monitor.collect();
      const pressure = this.monitor.getPressure(metrics);

      if (pressure !== 'normal') {
        const alert: Alert = {
          timestamp: metrics.timestamp,
          pressure,
          message: pressure === 'warning'
            ? '内存使用接近阈值'
            : '内存压力过高！',
          metrics,
        };
        this.alerts.push(alert);
        this.onAlert?.(alert);
      }
    }, intervalMs);
  }

  /** 停止监控 */
  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  /** 获取所有告警 */
  getAlerts(): readonly Alert[] {
    return this.alerts;
  }
}

function example7_alertSystem(): void {
  console.log('\n=== 示例 7: 资源预警系统 ===\n');

  const monitor = new ResourceMonitor({
    intervalMs: 100,
    memoryWarningThreshold: 0.5, // 降低阈值用于演示
    memoryCriticalThreshold: 0.8,
  });

  const alertSystem = new ResourceAlertSystem({
    monitor,
    onAlert: (alert: Alert) => {
      const usage = (alert.metrics.memory.heapUsed / alert.metrics.memory.heapTotal * 100).toFixed(1);
      console.log(`[${new Date(alert.timestamp).toLocaleTimeString()}] 🚨 ${alert.pressure.toUpperCase()}: ${alert.message} (${usage}%)`);
    },
  });

  console.log('启动预警系统，监控 2 秒...');

  alertSystem.start(200);

  // 运行 2 秒后停止
  setTimeout(() => {
    alertSystem.stop();
    const alerts = alertSystem.getAlerts();
    console.log(`\n监控结束，共产生 ${alerts.length} 个告警`);

    if (alerts.length > 0) {
      console.log('告警统计:');
      const warningCount = alerts.filter(a => a.pressure === 'warning').length;
      const criticalCount = alerts.filter(a => a.pressure === 'critical').length;
      console.log(`  - 警告: ${warningCount} 次`);
      console.log(`  - 危急: ${criticalCount} 次`);
    }
  }, 2000);
}

// ============================================================
// 示例 8: 格式化输出与报告生成
// ============================================================

function example8_formattingAndReports(): void {
  console.log('\n=== 示例 8: 格式化输出与报告 ===\n');

  const monitor = new ResourceMonitor();
  const metrics = monitor.collect();

  // 使用内置格式化
  console.log('内置格式化输出:');
  console.log(`  ${monitor.format(metrics)}`);

  // 自定义报告
  console.log('\n自定义报告:');
  console.log('+------------------------------------------+');
  console.log('|        AgentForge 资源监控报告           |');
  console.log('+------------------------------------------+');
  console.log(`| 采集时间: ${new Date(metrics.timestamp).toLocaleString()}`);
  console.log(`| 运行时长: ${(metrics.uptime / 1000).toFixed(2)} 秒`);
  console.log('+------------------------------------------+');
  console.log('| 内存指标:');
  console.log(`|   堆已用: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`|   堆总量: ${(metrics.memory.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`|   RSS:    ${(metrics.memory.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`|   外部:   ${(metrics.memory.external / 1024 / 1024).toFixed(2)} MB`);
  console.log('+------------------------------------------+');

  if (metrics.cpu) {
    console.log('| CPU 指标:');
    console.log(`|   用户态: ${(metrics.cpu.user / 1000).toFixed(2)} ms`);
    console.log(`|   内核态: ${(metrics.cpu.system / 1000).toFixed(2)} ms`);
    console.log('+------------------------------------------+');
  }

  if (metrics.eventLoopDelay !== undefined) {
    console.log('| 事件循环:');
    console.log(`|   延迟:   ${metrics.eventLoopDelay.toFixed(3)} ms`);
    console.log('+------------------------------------------+');
  }

  const pressure = monitor.getPressure(metrics);
  const pressureEmoji = pressure === 'normal' ? '✅' : pressure === 'warning' ? '⚠️' : '🚨';
  console.log(`| 状态: ${pressureEmoji} ${pressure.toUpperCase()}`);
  console.log('+------------------------------------------+');
}

// ============================================================
// 主函数
// ============================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('AgentForge 可观测性示例');
  console.log('========================================');

  // 同步示例
  example1_basicResourceMonitoring();
  example2_memoryPressureDetection();
  example4_agentIntegration();
  example5_performanceProfiling();
  example6_customAggregation();
  example8_formattingAndReports();

  // 异步示例（需要等待）
  console.log('\n运行异步示例...');

  // 示例 3: 持续监控流
  example3_continuousMonitoring();

  // 示例 7: 预警系统
  example7_alertSystem();

  // 等待异步示例完成
  await new Promise(resolve => setTimeout(resolve, 2500));

  console.log('\n========================================');
  console.log('所有示例运行完成');
  console.log('========================================\n');
}

// 执行主函数
main().catch(console.error);
