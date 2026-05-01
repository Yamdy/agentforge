/**
 * MPU (Minimum Production Usable) Interfaces
 *
 * 接口契约文件 - 定义所有 MPU 模块的接口规范
 * 所有 Agent 必须实现这些接口，不得修改此文件
 *
 * @module
 */

import type { Checkpoint, AgentState, SerializedError } from '../core/index.js';
import type { LLMUsage } from '../core/interfaces.js';
import type { CompactionManager } from '../memory/compaction.js';

// ============================================================
// M1 - 持久化存储
// ============================================================

/**
 * 检查点存储接口
 * 实现类必须支持 SQLite 或其他持久化存储
 */
export interface CheckpointStorage {
  /** 保存检查点 */
  save(checkpoint: Checkpoint): Promise<void>;

  /** 加载检查点，checkpointId 为空时返回最新 */
  load(sessionId: string, checkpointId?: string): Promise<Checkpoint | null>;

  /** 列出检查点，按时间倒序 */
  list(sessionId: string, limit?: number): Promise<Checkpoint[]>;

  /** 删除检查点 */
  delete(sessionId: string, checkpointId: string): Promise<void>;
}

/**
 * 会话存储接口
 */
export interface SessionStorage {
  /** 保存会话状态 */
  save(sessionId: string, state: AgentState): Promise<void>;

  /** 加载会话状态 */
  load(sessionId: string): Promise<AgentState | null>;

  /** 删除会话 */
  delete(sessionId: string): Promise<void>;

  /** 列出所有会话 */
  list(limit?: number): Promise<string[]>;
}

// ============================================================
// M3 - 沙箱隔离
// ============================================================

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** Docker 镜像 */
  image: string;
  /** CPU 限制 (e.g., "1.0") */
  cpuLimit: string;
  /** 内存限制 (e.g., "512m") */
  memoryLimit: string;
  /** 超时时间 (ms) */
  timeoutMs: number;
  /** 网络策略 */
  networkPolicy: 'none' | 'restricted' | 'open';
  /** 允许的域名（networkPolicy 为 restricted 时生效） */
  allowedDomains?: string[];
  /** 文件系统挂载 */
  filesystemMounts?: FilesystemMount[];
}

/**
 * 文件系统挂载配置
 */
export interface FilesystemMount {
  /** 宿主机路径 */
  hostPath: string;
  /** 容器内路径 */
  containerPath: string;
  /** 是否只读 */
  readOnly: boolean;
}

/**
 * 沙箱实例
 */
export interface SandboxInstance {
  /** 实例 ID */
  id: string;
  /** 容器 ID */
  containerId: string;
  /** 状态 */
  status: 'created' | 'running' | 'stopped' | 'destroyed';
  /** 创建时间 */
  createdAt: number;
}

/**
 * 沙箱命令
 */
export interface SandboxCommand {
  /** 可执行文件 */
  executable: string;
  /** 参数 */
  args: string[];
  /** 标准输入 */
  stdin?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  workingDir?: string;
}

/**
 * 沙箱执行结果
 */
export interface SandboxResult {
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行时长 (ms) */
  durationMs: number;
  /** 违规记录 */
  violations: SandboxViolation[];
}

/**
 * 沙箱违规
 */
export type SandboxViolation =
  | { type: 'path_violation'; path: string; mode: 'read' | 'write' }
  | { type: 'network_violation'; domain: string }
  | { type: 'timeout'; timeoutMs: number }
  | { type: 'memory_violation'; memoryMb: number }
  | { type: 'cpu_violation'; cpuMs: number };

/**
 * 容器沙箱接口
 */
export interface ContainerSandbox {
  /** 创建沙箱实例 */
  create(config: SandboxConfig): Promise<SandboxInstance>;

  /** 在沙箱中执行命令 */
  execute(instance: SandboxInstance, command: SandboxCommand): Promise<SandboxResult>;

  /** 销毁沙箱实例 */
  destroy(instance: SandboxInstance): Promise<void>;

  /** 列出所有实例 */
  list(): Promise<SandboxInstance[]>;
}

// ============================================================
// M4 - 异常熔断
// ============================================================

/**
 * 错误严重程度
 */
export type ErrorSeverity = 'minor' | 'moderate' | 'severe';

/**
 * 错误分类器接口
 */
export interface ErrorClassifier {
  /** 分类错误严重程度 */
  classify(error: SerializedError): ErrorSeverity;
}

/**
 * 熔断器状态
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * 熔断器配置
 */
export interface CircuitBreakerConfig {
  /** 失败阈值 */
  failureThreshold: number;
  /** 重置超时 (ms) */
  resetTimeoutMs: number;
  /** 半开状态最大尝试次数 */
  halfOpenMaxAttempts: number;
}

/**
 * 熔断器接口
 */
export interface CircuitBreaker {
  /** 记录失败，返回是否触发熔断 */
  recordFailure(severity: ErrorSeverity): boolean;

  /** 记录成功（half-open → closed 转换） */
  recordSuccess(): boolean;

  /** 检查是否应该熔断 */
  shouldTrip(): boolean;

  /** 重置熔断器 */
  reset(): void;

  /** 获取当前状态 */
  getState(): CircuitBreakerState;

  /** 获取失败计数 */
  getFailureCount(): number;

  /** 销毁熔断器，清理定时器 */
  destroy(): void;
}

/**
 * 修复上下文
 *
 * 传递给修复策略的完整上下文信息，
 * 包含错误详情、会话信息、LLM 适配器和压缩管理器等。
 */
export interface RepairContext {
  /** 序列化错误 */
  error: SerializedError;
  /** 重试次数 */
  retryCount: number;
  /** 会话 ID */
  sessionId: string;
  /** LLM 适配器（可选，用于需要 LLM 调用的策略） */
  llm?: import('../core/interfaces.js').LLMAdapter;
  /** 压缩管理器（可选，用于上下文压缩策略） */
  compactionManager?: CompactionManager;
  /** 消息列表（可选，用于需要消息上下文的策略如 compaction） */
  messages?: import('../core/events.js').Message[];
  /** 当前 token 估算（可选，用于 compaction 策略） */
  currentTokenEstimate?: number;
  /** 配置选项 */
  config?: { fallbackModel?: string; maxTokens?: number };
}

/**
 * 自动修复器接口
 */
export interface AutoRepairer {
  /** 尝试修复错误（向后兼容） */
  attemptRepair(error: SerializedError): Promise<RepairResult>;
  /** 尝试修复错误（使用完整上下文） */
  attemptRepair(ctx: RepairContext): Promise<RepairResult>;

  /** 注册修复策略 */
  registerStrategy(errorPattern: RegExp, handler: RepairHandler): void;
}

/**
 * 修复结果
 */
export interface RepairResult {
  /** 是否修复成功 */
  success: boolean;
  /** 修复描述 */
  description: string;
  /** 重试次数 */
  retryCount: number;
}

/**
 * 修复处理器类型
 */
export type RepairHandler = (ctx: RepairContext) => Promise<boolean>;

// ============================================================
// M5 - 审计日志
// ============================================================

/**
 * 审计事件类型
 */
export type AuditEventType =
  | 'permission.check'
  | 'permission.denied'
  | 'permission.granted'
  | 'tool.execute'
  | 'tool.error'
  | 'llm.request'
  | 'llm.response'
  | 'agent.start'
  | 'agent.complete'
  | 'agent.error'
  | 'injection.detected'
  | 'sandbox.violation'
  | 'rate.limited';

/**
 * 审计条目
 */
export interface AuditEntry {
  /** 唯一 ID */
  id: string;
  /** 时间戳 */
  timestamp: string;
  /** 会话 ID */
  sessionId: string;
  /** Agent 名称 */
  agentName: string;
  /** 事件类型 */
  eventType: AuditEventType;
  /** 操作描述 */
  action: string;
  /** 资源标识 */
  resource: string;
  /** 结果 */
  result: 'success' | 'denied' | 'error';
  /** 详细信息 */
  details: Record<string, unknown>;
  /** 前一条哈希（用于哈希链） */
  previousHash?: string;
  /** 当前条目哈希 */
  hash: string;
}

/**
 * 审计过滤器
 */
export interface AuditFilter {
  /** 按事件类型过滤 */
  eventType?: AuditEventType;
  /** 按会话 ID 过滤 */
  sessionId?: string;
  /** 按结果过滤 */
  result?: 'success' | 'denied' | 'error';
  /** 开始时间 */
  since?: string;
  /** 结束时间 */
  until?: string;
  /** 限制数量 */
  limit?: number;
}

/**
 * 完整性报告
 */
export interface IntegrityReport {
  /** 是否完整 */
  valid: boolean;
  /** 总条目数 */
  totalEntries: number;
  /** 哈希链断裂位置（如果有） */
  brokenAt?: number;
  /** 断裂条目的 ID */
  brokenEntryId?: string;
}

/**
 * 审计存储接口
 */
export interface AuditStore {
  /** 追加审计条目 */
  append(entry: Omit<AuditEntry, 'id' | 'hash' | 'previousHash'>): Promise<void>;

  /** 查询审计条目 */
  query(filter: AuditFilter): Promise<AuditEntry[]>;

  /** 验证完整性 */
  verifyIntegrity(): Promise<IntegrityReport>;

  /** 导出审计日志 */
  export(format: 'json' | 'csv'): Promise<string>;

  /** 获取条目数量 */
  count(): Promise<number>;
}

// ============================================================
// M7 - 成本管控
// ============================================================

/**
 * 成本限制
 */
export interface CostLimit {
  /** 最大 Token 数 */
  maxTokens?: number;
  /** 最大成本 (USD) */
  maxCost?: number;
  /** 最大请求数 */
  maxRequests?: number;
}

/**
 * 模型成本
 */
export interface ModelCost {
  /** 模型名称 */
  model: string;
  /** Token 用量 */
  tokens: LLMUsage;
  /** 成本 (USD) */
  cost: number;
  /** 请求次数 */
  requests: number;
}

/**
 * 成本分解
 */
export interface CostBreakdown {
  /** 会话 ID */
  sessionId: string;
  /** 总成本 */
  totalCost: number;
  /** 按模型分解 */
  byModel: Record<string, ModelCost>;
  /** 按工具分解 */
  byTool: Record<string, number>;
  /** 时间范围 */
  timeRange: { start: string; end: string };
}

/**
 * 限制检查结果
 */
export interface LimitCheckResult {
  /** 是否在限制内 */
  withinLimit: boolean;
  /** 当前用量 */
  current: CostBreakdown;
  /** 限制 */
  limit: CostLimit;
  /** 超限项 */
  exceeded?: string[];
}

/**
 * 成本追踪器接口
 */
export interface CostTracker {
  /** 记录成本 */
  record(sessionId: string, model: string, usage: LLMUsage): Promise<void>;

  /** 获取用量 */
  getUsage(sessionId: string): Promise<CostBreakdown>;

  /** 检查限制 */
  checkLimit(sessionId: string): Promise<LimitCheckResult>;

  /** 设置限制 */
  setLimit(sessionId: string, limit: CostLimit): Promise<void>;

  /** 获取限制 */
  getLimit(sessionId: string): Promise<CostLimit | null>;

  /** 重置用量 */
  reset(sessionId: string): Promise<void>;
}

// ============================================================
// M8 - 可观测性
// ============================================================

/**
 * 组件健康状态
 */
export interface ComponentHealth {
  /** 组件名称 */
  name: string;
  /** 状态 */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** 消息 */
  message?: string;
  /** 延迟 (ms) */
  latencyMs?: number;
}

/**
 * 健康状态
 */
export interface HealthStatus {
  /** 整体状态 */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** 版本 */
  version: string;
  /** 运行时长 (s) */
  uptime: number;
  /** 组件健康状态 */
  checks: ComponentHealth[];
}

/**
 * 就绪状态
 */
export interface ReadinessStatus {
  /** 是否就绪 */
  ready: boolean;
  /** 未就绪原因 */
  reasons?: string[];
}

/**
 * 健康检查器接口
 */
export interface HealthChecker {
  /** 检查健康状态 */
  check(): Promise<HealthStatus>;

  /** 检查就绪状态 */
  ready(): Promise<ReadinessStatus>;

  /** 注册组件检查 */
  registerCheck(name: string, checker: () => Promise<ComponentHealth>): void;
}

/**
 * 指标收集器接口
 */
export interface MetricsCollector {
  /** 增加计数器 */
  incrementCounter(name: string, labels?: Record<string, string>): void;

  /** 记录直方图 */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;

  /** 记录仪表盘 */
  recordGauge(name: string, value: number, labels?: Record<string, string>): void;

  /** 获取 Prometheus 格式指标 */
  getMetrics(): Promise<string>;

  /** 重置指标 */
  reset(): void;
}

// ============================================================
// M10 - 评估校验
// ============================================================

/**
 * 校验错误
 */
export interface ValidationError {
  /** 错误路径 */
  path: string;
  /** 错误消息 */
  message: string;
  /** 错误代码 */
  code?: string;
}

/**
 * 校验结果
 */
export interface ValidationResult {
  /** 是否有效 */
  valid: boolean;
  /** 错误列表 */
  errors: ValidationError[];
}

/**
 * 结果校验器接口
 */
export interface ResultValidator {
  /** 校验工具结果 */
  validate(toolName: string, result: unknown): ValidationResult;

  /** 注册校验 Schema */
  registerSchema(toolName: string, schema: unknown): void;

  /** 移除校验 Schema */
  removeSchema(toolName: string): void;
}

/**
 * 对齐结果
 */
export interface AlignmentResult {
  /** 是否对齐 */
  aligned: boolean;
  /** 置信度 (0-1) */
  confidence: number;
  /** 原因 */
  reason?: string;
  /** 建议 */
  suggestion?: string;
}

/**
 * 目标对齐检查器接口
 */
export interface GoalAlignmentChecker {
  /** 检查对齐 */
  checkAlignment(action: string, goal: string): AlignmentResult;

  /** Check alignment asynchronously with two-tier approach: Jaccard fast-path + LLM for borderline */
  checkAlignmentAsync(action: string, goal: string): Promise<AlignmentResult>;

  /** 设置目标 */
  setGoal(goal: string): void;

  /** 获取当前目标 */
  getGoal(): string | null;
}

/**
 * 完成度评分
 */
export interface CompletionScore {
  /** 完成百分比 (0-100) */
  percentage: number;
  /** 已完成步骤 */
  completedSteps: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 详情 */
  details: string[];
}

/**
 * 完成度评分器接口
 */
export interface CompletionScorer {
  /** 计算完成度 */
  score(plan: { steps: Array<{ status: string }> }): CompletionScore;
}
