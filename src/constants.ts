/**
 * 项目通用常量配置
 * 所有魔法数字和硬编码配置值都应该定义在此处
 */

// ==================== 服务器配置 ====================
export const DEFAULT_SERVER_PORT = 3000;
export const DEFAULT_API_TIMEOUT = 30000; // 30秒

// ==================== 速率限制 ====================
export const DEFAULT_MAX_REQUESTS = 100;
export const RATE_LIMIT_WINDOW_MS = 60000; // 1分钟

// ==================== Agent 配置 ====================
export const DEFAULT_MAX_STEPS = 10;
export const DEFAULT_MAX_ITERATIONS = 100;
export const DEFAULT_MAX_MESSAGES = 100;
export const DEFAULT_SESSION_MAX_MESSAGES = 50;

// ==================== 消息压缩 ====================
export const DEFAULT_COMPRESSION_THRESHOLD = 10;
export const COMPRESSION_TOKEN_RATIO = 1.3; // 每个单词约1.3个token

// ==================== 沙箱配置 ====================
export const DEFAULT_SANDBOX_TIMEOUT = 30000; // 30秒
export const DEFAULT_MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
export const DEFAULT_TIMEOUT_BUFFER = 100; // 100ms缓冲

// ==================== 工作流配置 ====================
export const DEFAULT_MAX_BROADCAST_DEPTH = 50;
export const DEFAULT_WORKFLOW_MAX_ITERATIONS = 100;

// ==================== 存储配置 ====================
export const DEFAULT_QUERY_LIMIT = 50;
export const DEFAULT_COMPACTION_THRESHOLD = 20;

// ==================== 行号索引 ====================
export const LINE_NUMBER_ONE_INDEXED = 1; // UI/API中行号从1开始

// ==================== 日志配置 ====================
export const DEFAULT_LOG_LEVEL = 'info';

// ==================== 版本配置 ====================
export const DEFAULT_VERSION = '1.0.0';

// ==================== 文本截断 ====================
export const DEFAULT_USER_INPUT_TRUNCATE_LENGTH = 100;
export const DEFAULT_EXEC_RESULT_TRUNCATE_LENGTH = 50;
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

// ==================== CLI 配置 ====================
export const CLI_DEFAULT_PORT = 4111;
export const CLI_TEMP_DIR = '.agentforge';
export const CLI_DEFAULT_DIR = '.agentforge';
export const CLI_DEFAULT_HOST = 'localhost';

// ==================== 压缩级别 ====================
export type CompressionLevel = 0 | 1 | 2 | 3 | 4;
export const COMPRESSION_LEVELS = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  MAXIMUM: 4,
} as const;
